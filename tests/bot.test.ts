import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Telegram } from 'telegraf';
import { buildBot } from '../src/bot.js';
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
