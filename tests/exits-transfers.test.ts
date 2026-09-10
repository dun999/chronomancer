import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeEventTopics, encodeAbiParameters, decodeFunctionData, erc20Abi, keccak256, type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {DreamDex, PreflightError} from '../src/assistant/dreamdex.js';
import {settings} from '../src/assistant/settings.js';
import type {Action,MarketView} from '../src/assistant/types.js';
const pk=`0x${'1'.repeat(64)}` as Hex;
const owner=privateKeyToAccount(pk).address, recipient=`0x${'2'.repeat(40)}` as const;
function harness(){
 const market:MarketView={id:`0x${'a'.repeat(64)}`,pool:`0x${'b'.repeat(40)}`,asset:'BTC',question:'BTC Up?',expiry:Date.now()/1000+3600,tradingStart:0,decimals:6,venueId:'test',upAsk:'450000',downAsk:'570000',upBid:'430000',downBid:'550000'};
 const oc={status:1,finalized:false,pool:market.pool,marketAddress:owner,yesId:1n,noId:2n,outcomeToken:owner,isResolved:false,isVoided:false,winningOutcome:0};
 let up=8000000n,down=3000000n,collateral=100000000n,stt=10n**18n,signs=0,sends=0,chainId=50312,quantity=10000000n;
 const hash=keccak256('0x1234'); let journaled=false,receiptStatus='success';
 const receipt=()=>({transactionHash:hash,status:receiptStatus,from:owner,to:settings.collateral,logs:[{
  address:settings.collateral,
  topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:owner,to:recipient}}),
  data:encodeAbiParameters([{type:'uint256'}],[quantity]),
 }]});
 const dex=Object.assign(Object.create(DreamDex.prototype),{
  wallets:{privateKey(){return pk;}},market:async()=>market,
  balances:async()=>({stt,collateral,decimals:6}),
  public:{getChainId:async()=>chainId,getBalance:async()=>stt,
   readContract:async()=>({market:owner,yesId:1n,finalized:false,collateralToken:settings.collateral,oneCollateral:1000000n}),
   simulateContract:async()=>({result:true}),estimateContractGas:async()=>100000n,
   sendRawTransaction:async()=>{assert(journaled,'journal must precede broadcast');sends++;return hash;},
   waitForTransactionReceipt:async()=>receipt(),getTransactionReceipt:async()=>receipt(),
  },
  transferWallet:()=>({prepareTransactionRequest:async(request:any)=>{const call=decodeFunctionData({abi:erc20Abi,data:request.data});assert.equal(call.functionName,'transfer');assert.deepEqual(call.args,[recipient,10000000n]);return {...request,maxFeePerGas:1n};},
   signTransaction:async()=>{signs++;return '0x1234';}}),
  exchange:{client:{getMarketOnchain:async()=>oc,getOutcomeBalance:async({id}:any)=>id===1n?up:down}},
 }) as DreamDex;
 return {dex,market,oc,receipt,hash,get signs(){return signs;},get sends(){return sends;},journal(){journaled=true;},
  setShares(u:bigint,d:bigint){up=u;down=d;},setFunds(c:bigint,g=stt){collateral=c;stt=g;},setChain(c:number){chainId=c;},setReceipt(s:string,q=quantity){receiptStatus=s;quantity=q;}};
}
test('exit routes use both on-chain legs; merge needs no bid, sales remain liquidity-dependent',async()=>{
 const h=harness();let o=await h.dex.exitOptions(owner,h.market.id,'Up');
 assert.equal(o.held,'8000000');assert.equal(o.pairs,'3000000');
 assert.deepEqual(o.choices.map(c=>[c.kind,c.amount]),[['merge','3'],['sell','8']]);
 h.market.upBid=null;o=await h.dex.exitOptions(owner,h.market.id,'Up');assert.deepEqual(o.choices.map(c=>c.kind),['merge']);
 h.setShares(8000000n,0n);assert.equal((await h.dex.exitOptions(owner,h.market.id,'Up')).choices.length,0);
 h.setShares(200000000n,200000000n);h.market.upBid='430000';
 assert((await h.dex.exitOptions(owner,h.market.id,'Up')).choices.every(c=>c.amount==='100'));
 assert.equal(h.signs,0);assert.equal(h.sends,0);
});
test('settlement, void, loss, locked markets and empty holdings have distinct exit paths',async()=>{
 const h=harness();h.oc.status=2;
 assert.match((await h.dex.exitOptions(owner,h.market.id,'Up')).note,/awaiting settlement/);
 h.oc.status=3;h.oc.finalized=true;h.oc.isResolved=true;
 assert.deepEqual((await h.dex.exitOptions(owner,h.market.id,'Up')).choices.map(c=>c.kind),['redeem']);
 assert.match((await h.dex.exitOptions(owner,h.market.id,'Down')).note,/lost/);
 h.oc.isVoided=true;
 assert.deepEqual((await h.dex.exitOptions(owner,h.market.id,'Down')).choices.map(c=>c.kind),['redeem']);
 h.setShares(0n,0n);assert.match((await h.dex.exitOptions(owner,h.market.id,'Up')).note,/No unescrowed/);
});
test('withdrawal rejects invalid destinations, zero, excess precision, over-limit, insufficient funds and wrong chain without signing',async()=>{
 const h=harness();
 for(const dest of ['alice.eth','0x00',`0x${'0'.repeat(40)}`,owner])await assert.rejects(()=>h.dex.transferQuote(owner,dest,'10'),PreflightError);
 for(const amount of ['0','-1','1e2','0.0000001','101'])await assert.rejects(()=>h.dex.transferQuote(owner,recipient,amount),PreflightError);
 h.setFunds(1n);await assert.rejects(()=>h.dex.transferQuote(owner,recipient,'10'),/Not enough/);
 h.setFunds(100000000n,0n);await assert.rejects(()=>h.dex.transferQuote(owner,recipient,'10'),/STT/);
 h.setFunds(100000000n,10n**18n);h.setChain(1);await assert.rejects(()=>h.dex.transferQuote(owner,recipient,'10'),/not Somnia/);
 assert.equal(h.signs,0);assert.equal(h.sends,0);
});
test('withdrawal rechecks funds, expiry and reviewed quantity; simulation failure cannot sign',async()=>{
 const h=harness(),q=await h.dex.transferQuote(owner,recipient,'10');
 h.setFunds(1n);await assert.rejects(()=>h.dex.execute('1',owner,q),PreflightError);h.setFunds(100000000n);
 await assert.rejects(()=>h.dex.execute('1',owner,{...q,expiresAt:0}),/expired/);
 await assert.rejects(()=>h.dex.execute('1',owner,{...q,quantity:'1'}),/amount changed/);
 Object.assign(h.dex.public,{simulateContract:async()=>({result:false})});
 await assert.rejects(()=>h.dex.execute('1',owner,q),/simulation failed/);
 assert.equal(h.signs,0);assert.equal(h.sends,0);
});
test('withdrawal journals before broadcast, verifies the exact token payment and recovers without resending',async()=>{
 const h=harness(),q=await h.dex.transferQuote(owner,recipient,'10');
 const a:Action={id:'1',userId:'1',quote:q,state:'unknown',createdAt:Date.now(),submissions:[]};
 const result=await h.dex.execute('1',owner,q,s=>{h.journal();a.submissions!.push(s);});
 assert.equal(result.hash,h.hash);assert.equal(result.cash,'10');assert.match(result.summary,new RegExp(recipient));
 assert.equal(h.signs,1);assert.equal(h.sends,1);
 assert.equal((await h.dex.reconcile(owner,a))?.state,'confirmed');assert.equal(h.sends,1);
 h.setReceipt('success',1n);await assert.rejects(()=>h.dex.reconcile(owner,a),/reviewed token payment/);
 h.setReceipt('reverted');assert.equal((await h.dex.reconcile(owner,a))?.state,'failed');
});
test('a broadcast timeout retains a recoverable hash; fee preparation failure remains a known no-send',async()=>{
 const h=harness(),q=await h.dex.transferQuote(owner,recipient,'10');
 const a:Action={id:'1',userId:'1',quote:q,state:'unknown',createdAt:Date.now(),submissions:[]};
 Object.assign(h.dex.public,{sendRawTransaction:async()=>{throw new Error('timeout');}});
 await assert.rejects(()=>h.dex.execute('1',owner,q,s=>a.submissions!.push(s)),/timeout/);
 assert.equal(a.submissions!.length,1);assert.equal((await h.dex.reconcile(owner,a))?.state,'confirmed');
 Object.assign(h.dex,{transferWallet:()=>({prepareTransactionRequest:async()=>{throw new Error('rpc down');}})});
 await assert.rejects(()=>h.dex.execute('1',owner,q),PreflightError);
 assert.equal(h.signs,1);
});

test('transfer preserves native gas reserve even when the token balance covers the payment',async()=>{
 const h=harness(),q=await h.dex.transferQuote(owner,recipient,'10');
 h.setFunds(100000000n,10n**16n);
 await assert.rejects(()=>h.dex.execute('1',owner,q),/gas reserve/);
 assert.equal(h.signs,0);assert.equal(h.sends,0);
});
