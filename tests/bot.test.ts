import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Telegram } from 'telegraf';
import { buildBot } from '../src/bot.js';
import { AgentError } from '../src/assistant/agent.js';
import { settings } from '../src/assistant/settings.js';
import { Ledger } from '../src/assistant/ledger.js';
import { Wallets } from '../src/assistant/wallets.js';
import type { DreamDex } from '../src/assistant/dreamdex.js';
import type { MarketView, Quote } from '../src/assistant/types.js';

test('Telegram journey: no AI onboarding, wallet, entry, receipt, replay protection and real-number position image',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-journey-')),ledger=new Ledger(dir),wallets=new Wallets(ledger,dir);
 const market:MarketView={id:`0x${'a'.repeat(64)}`,pool:`0x${'b'.repeat(40)}`,asset:'BTC',question:'BTC Up?',expiry:Date.now()/1000+3600,tradingStart:Date.now()/1000-60,decimals:6,venueId:'test',upAsk:'450000',downAsk:'570000',upBid:'430000',downBid:'550000'};
 let writes=0,ais=0,update=0;
 const sent:Array<{method:string;payload:Record<string,any>}>=[];
 const api=mock.method(Telegram.prototype,'callApi',async(method:string,payload:Record<string,any>)=>{
  sent.push({method,payload});return {message_id:sent.length,chat:{id:1,type:'private'}} as any;
 });
 const dex={
  balances:async()=>({stt:1000000000000000000n,collateral:100000000n,decimals:6}),
  markets:async()=>({markets:[market],next:null}),market:async()=>market,
  quote:async(kind:Quote['kind'],m:MarketView,side:Quote['side'],amount:string)=>({kind,market:m,side,amount,quantity:'20000000',price:'470000',maxCost:'9400000',minReceive:'0',expiresAt:Date.now()+60000}),
  execute:async()=>{writes++;return{hash:`0x${'c'.repeat(64)}`,filled:'3',cash:'1.35',summary:'3 Up shares filled · 1.35 tUSDC fill cost (before fees). Unfilled remainder cancelled.'};},
  portfolio:async()=>[],close:()=>{},
  position:async()=>({market,side:'Up',balance:'3000000',cost:'1350000',value:'1500000',pnl:'150000',realized:'0',status:'Open',asOf:Date.now(),indexed:true}),
 } as unknown as DreamDex;
 const runtime=buildBot({ledger,wallets,dex,agent:async()=>{ais++;return{intent:'explain',reply:'No clear edge.',marketId:null,side:null,amount:null,picks:[]};}},'test-token');
 runtime.bot.botInfo={id:42,is_bot:true,first_name:'Test',username:'test_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false};
 const message=async(text:string,user=1,type='private')=>runtime.bot.handleUpdate({update_id:++update,message:{message_id:update,date:1,chat:{id:user,type},from:{id:user,is_bot:false,first_name:'Alice'},text,...(text.startsWith('/')?{entities:[{offset:0,length:text.length,type:'bot_command'}]}:{})}} as any);
 const click=async(label:string,user=1,data?:string)=>{
  const chosen=data??sent.flatMap(x=>x.payload.reply_markup?.inline_keyboard?.flat()??[]).filter((b:any)=>b.text===label).at(-1)?.callback_data;
  assert(chosen,`Missing button ${label}`);
  await runtime.bot.handleUpdate({update_id:++update,callback_query:{id:String(update),chat_instance:'1',from:{id:user,is_bot:false,first_name:'Alice'},data:chosen,message:{message_id:1,date:1,chat:{id:user,type:'private'}}}} as any);
  return chosen;
 };
 try{
  await message('/start');const address=ledger.user('1')!.address;
  await message('/start');assert.equal(ledger.user('1')!.address,address);
  await click('Continue → Meet DreamDEX');await click('Continue → What makes it different?');await click('Continue → Fund my wallet');await click('I topped up · check balance');
  assert.equal(ledger.user('1')!.stage,3);assert.equal(ais,0);
  await message('/market');
  const marketButton=sent.flatMap(x=>x.payload.reply_markup?.inline_keyboard?.flat()??[]).find((b:any)=>b.text.startsWith('BTC ·'));
  await click('',1,marketButton.callback_data);await click('↗ Buy Up');await click('10');
  const confirm=sent.flatMap(x=>x.payload.reply_markup?.inline_keyboard?.flat()??[]).filter((b:any)=>b.text==='Confirm transaction').at(-1).callback_data;
  await click('',2,confirm);assert.equal(writes,0);
  await click('',1,confirm);assert.equal(writes,1);assert.equal(ais,0);
  await click('',1,confirm);assert.equal(writes,1);
  assert(sent.some(x=>x.payload.text?.includes('3 Up shares filled')));
  await message('could you check my position');assert.equal(ais,0);
  await click('BTC Up · aaaaaa');assert(sent.some(x=>x.method==='sendPhoto'&&Buffer.isBuffer(x.payload.photo.source)));
  await message('/activity');assert(sent.some(x=>x.payload.text?.includes('Transaction receipt')));
  await message('/start',3,'group');assert.equal(ledger.user('3'),undefined);
 }finally{api.mock.restore();runtime.close();rmSync(dir,{recursive:true,force:true});}
});

/** The 2026-09-07 outage: a text message took longer than Telegraf's handler
 *  timeout, the default error handler rethrew, and the rejection tore down long
 *  polling while the process stayed alive and ignored every later message. */
test('a stalled handler is contained: the update resolves, the user hears back, and polling is never rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-stall-')),ledger=new Ledger(dir),wallets=new Wallets(ledger,dir);
 const handler=settings.handlerTimeoutMs,marketBudget=settings.marketTimeoutMs;
 const sent:Array<{method:string;payload:Record<string,any>}>=[];
 const api=mock.method(Telegram.prototype,'callApi',async(method:string,payload:Record<string,any>)=>{
  sent.push({method,payload});return {message_id:sent.length,chat:{id:1,type:'private'}} as any;
 });
 // The market read outlives the handler, exactly as the live indexer did.
 const dex={markets:()=>new Promise(()=>{}),portfolio:async()=>[],close:()=>{}} as unknown as DreamDex;
 settings.handlerTimeoutMs=250;settings.marketTimeoutMs=60_000;
 const runtime=buildBot({ledger,wallets,dex,agent:async()=>{throw new Error('never reached');}},'test-token');
 runtime.bot.botInfo={id:42,is_bot:true,first_name:'Test',username:'test_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false};
 const message=(text:string,update:number)=>runtime.bot.handleUpdate({update_id:update,message:{message_id:update,date:1,chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'Alice'},text,...(text.startsWith('/')?{entities:[{offset:0,length:text.length,type:'bot_command'}]}:{})}} as any);
 try{
  // A rejection here is what killed the poller; handleUpdate must settle cleanly.
  await message('could you help me to pick interesting market',1);
  assert.equal(process.exitCode??0,0,'a contained handler failure must not mark the process failed');
  assert(sent.some(x=>x.payload.text?.includes('took longer than I can wait')),'the user is told the request was abandoned');
  // The bot still answers the next update rather than going silent.
  sent.length=0;await message('/help',2);
  assert(sent.some(x=>x.payload.text?.includes('/market — browse open markets')));
 }finally{settings.handlerTimeoutMs=handler;settings.marketTimeoutMs=marketBudget;api.mock.restore();runtime.close();rmSync(dir,{recursive:true,force:true});}
});
test('a slow market read and each AI failure get their own answer, well inside the handler timeout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-budget-')),ledger=new Ledger(dir),wallets=new Wallets(ledger,dir);
 const marketBudget=settings.marketTimeoutMs;
 const sent:Array<{method:string;payload:Record<string,any>}>=[];
 const api=mock.method(Telegram.prototype,'callApi',async(method:string,payload:Record<string,any>)=>{
  sent.push({method,payload});return {message_id:sent.length,chat:{id:1,type:'private'}} as any;
 });
 const market:MarketView={id:`0x${'a'.repeat(64)}`,pool:`0x${'b'.repeat(40)}`,asset:'BTC',question:'BTC Up?',expiry:Date.now()/1000+3600,tradingStart:Date.now()/1000-60,decimals:6,venueId:'test',upAsk:'450000',downAsk:'570000',upBid:'430000',downBid:'550000'};
 let stall=true,failure:AgentError=new AgentError('timeout','slow');
 const dex={markets:async()=>{if(stall)return new Promise(()=>{}) as any;return{markets:[market],next:null};},portfolio:async()=>[],close:()=>{}} as unknown as DreamDex;
 settings.marketTimeoutMs=200;
 const runtime=buildBot({ledger,wallets,dex,agent:async()=>{throw failure;}},'test-token');
 runtime.bot.botInfo={id:42,is_bot:true,first_name:'Test',username:'test_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false};
 let update=0;
 const ask=async(text:string)=>{sent.length=0;
  // The 8s AI cooldown is per user, so each probe speaks as a new one.
  await runtime.bot.handleUpdate({update_id:++update,message:{message_id:update,date:1,chat:{id:update,type:'private'},from:{id:update,is_bot:false,first_name:'Alice'},text}} as any);
  return sent.map(x=>String(x.payload.text??'')).join('\n');};
 try{
  assert.match(await ask('find me an opportunity'),/live market data.*AI service could not answer/i);
  stall=false;
  assert.match(await ask('find me an opportunity'),/took too long to answer/i);
  failure=new AgentError('http','gateway down',true);
  assert.match(await ask('find me an opportunity'),/service is unavailable/i);
  failure=new AgentError('invalid','not JSON',true);
  assert.match(await ask('find me an opportunity'),/could not read/i);
  failure=new AgentError('unconfigured','no key');
  assert.match(await ask('find me an opportunity'),/not configured yet/i);
 }finally{settings.marketTimeoutMs=marketBudget;api.mock.restore();runtime.close();rmSync(dir,{recursive:true,force:true});}
});

test('RPC failures and timeouts reach the agent for chat and /market without dispatching trades',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-outage-')),ledger=new Ledger(dir),wallets=new Wallets(ledger,dir);
 const previous=settings.marketTimeoutMs;settings.marketTimeoutMs=20;
 const sent:string[]=[],calls:any[]=[];let reads=0,stall=false;
 const api=mock.method(Telegram.prototype,'callApi',async(_method:string,payload:any)=>{sent.push(payload.text??'');return {message_id:sent.length,chat:{id:1,type:'private'}} as any;});
 const dex={markets:async()=>{reads++;if(stall)return new Promise(()=>{});throw Object.assign(new Error('private provider detail'),{name:'RpcError'});},close:()=>{}} as unknown as DreamDex;
 const runtime=buildBot({ledger,wallets,dex,agent:async(...args)=>{calls.push(args);return {intent:'buy',reply:'Sorry, the market connection is down. I can still explain how Up and Down shares work.',marketId:'untrusted',side:'Up',amount:'10',picks:[]};}},'test-token');
 runtime.bot.botInfo={id:42,is_bot:true,first_name:'Test',username:'test_bot',can_join_groups:false,can_read_all_group_messages:false,supports_inline_queries:false};
 try{
  for(const [i,text] of ['hey','find an opportunity','/market','what are Up shares?'].entries()){
   stall=i===3;
   await runtime.bot.handleUpdate({update_id:i+1,message:{message_id:i+1,date:1,chat:{id:i+1,type:'private'},from:{id:i+1,is_bot:false,first_name:'Alice'},text,...(text.startsWith('/')?{entities:[{offset:0,length:text.length,type:'bot_command'}]}:{})}} as any);
   assert.match(sent.at(-1)!,/I can still explain/);
   assert.deepEqual(calls[i][1],[]);assert.equal(calls[i][3],undefined);assert.equal(calls[i][4],'unavailable');
   assert.equal(ledger.session<any>(String(i+1),{}).history.at(-1).content,sent.at(-1));
  }
  assert.equal(calls.length,4);assert.equal(reads,4,'outage replies never retry market or trade dispatch');
  assert(!sent.some(x=>x.includes('private provider detail')));
 }finally{settings.marketTimeoutMs=previous;api.mock.restore();runtime.close();rmSync(dir,{recursive:true,force:true});}
});
