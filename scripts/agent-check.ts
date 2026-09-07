/** Calls the configured AI only. Fixtures are synthetic; there is no signer or trade execution. */
import assert from 'node:assert/strict';
import { askAgent } from '../src/assistant/agent.js';
import { settings } from '../src/assistant/settings.js';
import type { MarketView } from '../src/assistant/types.js';
settings.newsKey = ''; // Test abstention when there is no independent evidence.
const market:MarketView={
  id:`0x${'a'.repeat(64)}`,pool:`0x${'b'.repeat(40)}`,asset:'BTC',
  question:'SYNTHETIC TEST FIXTURE: will BTC close at or above its opening price?',
  expiry:Math.floor(Date.now()/1000)+1800,tradingStart:Math.floor(Date.now()/1000)-60,
  decimals:6,venueId:'synthetic',upAsk:'450000',downAsk:'570000',upBid:'430000',downBid:'550000',
};
const cases=[
  {name:'simple explanation',request:'Explain DreamDEX in simple words. What do STT and tUSDC do?',expected:'explain'},
  {name:'explicit trade request',request:'Please buy 10 tUSDC of Up on this selected market. This is an intent parsing test, do not claim a transaction happened.',expected:'buy'},
  {name:'opportunity without evidence',request:'Find a good opportunity here. Which market do you have conviction in?',expected:'opportunities'},
] as const;
console.log(`Testing ${settings.aiProvider} / ${settings.aiModel}; synthetic inputs, no transactions.`);
let failures=0;
for(const c of cases){
 const start=Date.now();
 try{
  const d=await askAgent(c.request,[market],[],{marketId:market.id,side:'Up'});
  assert.equal(d.intent,c.expected);
  if(c.expected==='buy'){assert.equal(d.marketId,market.id);assert.equal(d.side,'Up');assert.equal(d.amount,'10');}
  if(c.expected==='opportunities')assert.equal(d.picks.length,0);
  console.log(JSON.stringify({test:c.name,result:'PASS',elapsedMs:Date.now()-start,intent:d.intent,reply:d.reply.slice(0,700)}));
 }catch(e){failures++;console.error(JSON.stringify({test:c.name,result:'FAIL',error:e instanceof Error?e.message:'Unknown error'}));}
}
process.exitCode=failures?1:0;
