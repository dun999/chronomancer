import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/assistant/ledger.js';
import { Wallets } from '../src/assistant/wallets.js';
import { receiptFills, sizeBudget, units } from '../src/assistant/math.js';
import { cardSvg, positionCard } from '../src/assistant/cards.js';
import { AgentError, askAgent, parseAgentJson, validateDecision } from '../src/assistant/agent.js';
import { settings } from '../src/assistant/settings.js';
import type { MarketView, Quote, PositionView } from '../src/assistant/types.js';
export const market:MarketView={id:`0x${'a'.repeat(64)}`,pool:`0x${'b'.repeat(40)}`,asset:'BTC',question:'Will BTC close above its opening price?',expiry:Math.floor(Date.now()/1000)+3600,tradingStart:Math.floor(Date.now()/1000)-60,decimals:6,venueId:'test',upAsk:'450000',downAsk:'570000',upBid:'430000',downBid:'550000'};
export const quote:Quote={kind:'buy',market,side:'Up',amount:'10',quantity:'20000000',price:'470000',maxCost:'9400000',minReceive:'0',expiresAt:Date.now()+60000};
export const position:PositionView={market,side:'Up',balance:'20000000',cost:'9000000',value:'11000000',pnl:'2000000',realized:'0',status:'Open',asOf:Date.now(),indexed:true};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'assistant-test-'));const ledger=new Ledger(dir);const wallets=new Wallets(ledger,dir);return{dir,ledger,wallets,close(){ledger.close();rmSync(dir,{recursive:true,force:true});}};}
test('wallets are unique, durable, encrypted and owner-bound',()=>{
 const f=fixture();try{
  const a=f.wallets.ensure('1','Alice'),b=f.wallets.ensure('2','Bob');
  assert.notEqual(a.address,b.address); assert.equal(f.wallets.ensure('1','Alice').address,a.address);
  assert.equal(new Wallets(f.ledger,f.dir).privateKey('1'),f.wallets.privateKey('1'));
  assert.equal(statSync(join(f.dir,'wallet-master.key')).mode&0o777,0o600);
  assert(!a.wallet.includes(f.wallets.privateKey('1')));
  assert.throws(()=>new Wallets(f.ledger,f.dir,'a'.repeat(64)));
  f.ledger.createUser({...a,id:'3'});assert.throws(()=>f.wallets.privateKey('3'));
 }finally{f.close();}
});
test('confirmations reject replay, wrong user, superseded quote and concurrent execution',()=>{
 const f=fixture();try{
  const a=f.ledger.prepare('1',quote); assert.throws(()=>f.ledger.claim(a.id,'2'));
  const next=f.ledger.prepare('1',quote);assert.throws(()=>f.ledger.claim(a.id,'1'));
  f.ledger.claim(next.id,'1');assert.throws(()=>f.ledger.claim(next.id,'1'));
  assert.throws(()=>f.ledger.prepare('1',quote));
  f.ledger.finish(next.id,'1','unknown');assert.throws(()=>f.ledger.prepare('1',quote));
  assert.equal(f.ledger.claimUpdate(5),true);assert.equal(f.ledger.claimUpdate(5),false);
 }finally{f.close();}
});
test('confirmation remains consumed after restart and expires before signing',()=>{
 const f=fixture();try{
  const a=f.ledger.prepare('1',{...quote,expiresAt:1});assert.throws(()=>f.ledger.claim(a.id,'1'));
  const next=f.ledger.prepare('1',quote);f.ledger.claim(next.id,'1');
  const other=new Ledger(f.dir);assert.throws(()=>other.claim(next.id,'1'));other.close();
 }finally{f.close();}
});
test('daily streak uses UTC calendar days, with no repeat rewards and gap reset',()=>{
 const f=fixture();try{
  f.wallets.ensure('1','Alice');const day=Date.parse('2026-09-06T23:59:00Z');
  assert.equal(f.ledger.checkIn('1',day).streak,1);
  assert.equal(f.ledger.checkIn('1',day+1000).xp,10);
  assert.equal(f.ledger.checkIn('1',day+60000).streak,2);
  assert.equal(f.ledger.checkIn('1',day+3*86400000).streak,1);
 }finally{f.close();}
});
test('exact budget sizing stays under cap across awkward prices and fee grids',()=>{
 for(const d of [6,18])for(let p=1;p<1000;p++){
  const scale=10n**BigInt(d),price=BigInt(p)*scale/1000n,lot=scale/1000n,budget=10n*scale;
  const x=sizeBudget(budget,price,scale,lot,20000n);
  assert(x.maxCost<=budget);assert.equal(x.quantity%lot,0n);
 }
 assert.throws(()=>units('1e6',6));assert.throws(()=>units('0',6));assert.throws(()=>units('-1',6));assert.throws(()=>units('0.0000001',6));
});
test('receipt fill accounting uses actual partial quantities and correct Down complement',()=>{
 const fills=[{takerOrderId:1n,makerOrderId:2n,quantityFilled:3000000n,takerRemainingQuantity:17000000n,makerRemainingQuantity:0n,fillPrice:650000n}];
 assert.deepEqual(receiptFills(fills,'Down',6),{filled:'3',cash:'1.05'});
 assert.deepEqual(receiptFills([],'Up',6),{filled:'0',cash:'0'});
});
test('position image uses supplied numbers, escapes labels, and leaves unknown marks unknown',()=>{
 const png=positionCard(position,3);assert.equal(png.subarray(1,4).toString(),'PNG');
 const svg=cardSvg({...position,market:{...market,asset:'<script>'}},3);assert(svg.includes('&lt;script&gt;'));assert(svg.includes('+2.00'));
 const pending=cardSvg({...position,pnl:null,cost:null,value:null,indexed:false},3);assert(pending.includes('Awaiting price'));assert(pending.includes('Indexer catching up'));
});
test('agent cannot invent a market or cite missing evidence',()=>{
 const base={intent:'opportunities',reply:'Review these carefully.',marketId:null,side:null,amount:null,picks:[{marketId:market.id,side:'Up',conviction:'medium',reason:'Example',evidence:['https://invented.test']}]};
 assert.equal(validateDecision(base,[market],[]).picks.length,0);
 assert.throws(()=>validateDecision({...base,marketId:'0xdead'},[market],[]));
});
test('a decision survives Markdown fences and surrounding prose, and a truly broken reply is typed',()=>{
 const object={intent:'explain',reply:'Up and Down shares form a set.',marketId:null,side:null,amount:null,picks:[]};
 const json=JSON.stringify(object);
 for(const raw of [json,`\n${json}\n`,'```json\n'+json+'\n```','```\n'+json+'\n```',
   `Sure! Here is the decision:\n${json}\nLet me know if you want more.`,
   'Here you go:\n```json\n'+json+'\n```\nHope that helps.'])
  assert.deepEqual(parseAgentJson(raw),object,`failed to recover from: ${raw.slice(0,40)}`);
 // Braces inside strings must not end the object early.
 assert.equal((parseAgentJson('prefix {"reply":"a } brace","picks":[]} suffix') as {reply:string}).reply,'a } brace');
 for(const broken of ['','not json at all','{"intent":']){
  assert.throws(()=>parseAgentJson(broken),(e:unknown)=>e instanceof AgentError&&e.kind==='invalid'&&e.retryable);
 }
});
/** The first call after a restart pays for DNS and TLS and was measured past
 *  30s on the live box while warm calls took four; one retry recovers it. A
 *  fenced or prose-wrapped reply must not cost the user their answer either. */
test('a cold-start timeout and an unreadable reply are each retried once, inside one budget',async()=>{
 const saved={...settings},decision={intent:'explain',reply:'Up and Down form a set.',marketId:null,side:null,amount:null,picks:[]};
 const reply=(content:string)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}),{status:200,headers:{'Content-Type':'application/json'}});
 const scenarios:Array<{name:string;first:()=>Promise<Response>}>=[
  {name:'cold-start timeout',first:async()=>{const e=new Error('timed out');e.name='TimeoutError';throw e;}},
  {name:'markdown fence with prose',first:async()=>reply('Sure!\n```json\n{"broken":\n```')},
  {name:'gateway 503',first:async()=>new Response('busy',{status:503})},
 ];
 try{
  Object.assign(settings,{aiKey:'test-key',aiModel:'test-model',aiApi:'chat',aiProvider:'openrouter',
   aiEndpoint:'https://example.test/v1/chat/completions',aiTimeoutMs:5_000,newsKey:''});
  for(const s of scenarios){
   let calls=0;
   const fetchMock=mock.method(globalThis,'fetch',async()=>{calls++;return calls===1?s.first():reply('```json\n'+JSON.stringify(decision)+'\n```');});
   try{
    const d=await askAgent('Explain DreamDEX.',[],[]);
    assert.equal(calls,2,`${s.name}: expected exactly one retry`);
    assert.equal(d.intent,'explain',`${s.name}: the recovered decision is used`);
    assert.equal(d.reply,decision.reply);
   }finally{fetchMock.mock.restore();}
  }
  // A retry must never outlive the budget: both attempts fail, one error surfaces.
  const always=mock.method(globalThis,'fetch',async()=>new Response('busy',{status:503}));
  try{
   const started=Date.now();
   await assert.rejects(()=>askAgent('Explain DreamDEX.',[],[]),(e:unknown)=>e instanceof AgentError&&e.kind==='http');
   assert(Date.now()-started<settings.aiTimeoutMs*2,'the whole call stays inside its deadline');
   assert.equal(always.mock.callCount(),2,'it stops after the retry rather than looping');
  }finally{always.mock.restore();}
 }finally{Object.assign(settings,saved);}
});

test('unavailable market context tells the model to answer and removes stale trading output',async()=>{
 const saved={...settings};let body:any;
 Object.assign(settings,{aiKey:'test',aiModel:'test',aiApi:'chat',newsKey:''});
 const fetchMock=mock.method(globalThis,'fetch',async(_url:any,options:any)=>{
  body=JSON.parse(options.body);
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({intent:'buy',reply:'Sorry, live data is unavailable. I can explain complete sets.',marketId:market.id,side:'Up',amount:'10',picks:[{marketId:market.id}]})}}]}));
 });
 try{
  const result=await askAgent('explain complete sets',[market],[],{marketId:market.id,side:'Up'},'unavailable');
  assert.match(body.messages[0].content,/Live market data status: unavailable/);
  const context=JSON.parse(body.messages.at(-1).content);
  assert.deepEqual(context.markets,[]);assert.equal(context.selected,undefined);
  assert.equal(result.intent,'explain');assert.equal(result.marketId,null);assert.equal(result.amount,null);assert.deepEqual(result.picks,[]);
  assert.match(result.reply,/explain complete sets/);
 }finally{fetchMock.mock.restore();Object.assign(settings,saved);}
});
