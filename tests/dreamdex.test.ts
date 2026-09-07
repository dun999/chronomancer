import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DreamDex, PreflightError} from '../src/assistant/dreamdex.js';
import {settings} from '../src/assistant/settings.js';
import type {MarketView, Quote, Action} from '../src/assistant/types.js';
const addr=`0x${'1'.repeat(40)}` as const;
function harness(){
 const market:MarketView={id:`0x${'a'.repeat(64)}`,pool:`0x${'b'.repeat(40)}`,asset:'BTC',question:'BTC Up?',expiry:Date.now()/1000+3600,tradingStart:Date.now()/1000-60,decimals:6,venueId:'test',upAsk:'450000',downAsk:'570000',upBid:'430000',downBid:'550000'};
 const oc={status:1,finalized:false,pool:market.pool,marketAddress:addr,yesId:1n,noId:2n,outcomeToken:addr,isResolved:false,isVoided:false,winningOutcome:0};
 let stt=1000000000000000000n,collateral=100000000n,shares=50000000n,chainId=50312;
 let signerRequests=0;
 const gateway=Object.assign(Object.create(DreamDex.prototype),{
  wallets:{privateKey(){signerRequests++;return `0x${'1'.repeat(64)}`;}},
  public:{getChainId:async()=>chainId,readContract:async()=>({market:addr,yesId:1n,finalized:false,collateralToken:settings.collateral,oneCollateral:1000000n,takerFeeBpsTimes1k:0n,makerFeeBpsTimes1k:0n})},
  exchange:{client:{getMarketOnchain:async()=>oc,getBinaryBookParams:async()=>({tickSize:1000n,lotSize:1000n,minQuantity:1000n}),getOutcomeBalance:async()=>shares}},
  market:async()=>market,balances:async()=>({stt,collateral,decimals:6}),
 }) as DreamDex;
 return {gateway,market,oc,setBalances(g:bigint,c:bigint){stt=g;collateral=c;},setShares(n:bigint){shares=n;},setChain(n:number){chainId=n;},get signerRequests(){return signerRequests;}};
}
test('quotes protect budget for both sides and reject missing liquidity',async()=>{
 const h=harness();for(const side of ['Up','Down'] as const){
  const q=await h.gateway.quote('buy',h.market,side,'10',addr);
  assert(BigInt(q.maxCost)<=10000000n);
  const price=side==='Up'?BigInt(q.price):1000000n-BigInt(q.price);
  assert(BigInt(q.quantity)*price/1000000n<=10000000n);
 }
 h.market.downAsk=null;await assert.rejects(()=>h.gateway.quote('buy',h.market,'Down','10',addr),/No liquidity/);
});
test('locked markets, expiring windows and wrong chains cannot produce trade quotes',async()=>{
 const h=harness();h.oc.status=2;await assert.rejects(()=>h.gateway.quote('buy',h.market,'Up','10',addr),/closing/);
 h.oc.status=1;h.market.expiry=Date.now()/1000+60;await assert.rejects(()=>h.gateway.quote('buy',h.market,'Up','10',addr),/closing/);
 h.market.expiry=Date.now()/1000+3600;h.setChain(1);await assert.rejects(()=>h.gateway.quote('buy',h.market,'Up','10',addr),/not Somnia/);
});
test('insufficient funds fail before any signer is accessed',async()=>{
 const h=harness(),q=await h.gateway.quote('buy',h.market,'Up','10',addr);
 h.setBalances(0n,100000000n);await assert.rejects(()=>h.gateway.execute('1',addr,q),PreflightError);
 h.setBalances(1000000000000000000n,0n);await assert.rejects(()=>h.gateway.execute('1',addr,q),PreflightError);
 assert.equal(h.signerRequests,0);
});
test('redeem handles both void outcomes and refuses a losing side',async()=>{
 const h=harness();h.oc.status=3;h.oc.finalized=true;h.oc.isResolved=true;
 await assert.rejects(()=>h.gateway.quote('redeem',h.market,'Down','0',addr),/no payout/);
 h.oc.isResolved=false;h.oc.isVoided=true;
 for(const side of ['Up','Down'] as const)assert.equal((await h.gateway.quote('redeem',h.market,side,'0',addr)).quantity,'50000000');
 h.setShares(0n);await assert.rejects(()=>h.gateway.quote('redeem',h.market,'Up','0',addr),/Nothing/);
});
test('signing journals the hash before broadcast and reports zero fills honestly',async()=>{
 const h=harness(),q=await h.gateway.quote('buy',h.market,'Up','10',addr);
 let recorded=false;let purpose='';
 Object.assign(h.gateway,{makeExchange(account:any){return{
  client:{getMarketOnchain:async()=>h.oc},close(){},
  trader:{async placeOrder(params:any){
   await account.signTransaction({chainId:50312,to:q.market.pool,nonce:0,gas:21000n,maxFeePerGas:1n,maxPriorityFeePerGas:0n,value:0n,data:'0x'});
   assert(recorded,'hash must be durable before broadcast');
   assert.equal(params.quantity,BigInt(q.quantity));assert.equal(params.orderType,2);
   return{hash:`0x${'c'.repeat(64)}`,receipt:{status:'success',transactionHash:`0x${'c'.repeat(64)}`},fills:[]};
  }},
 };}});
 const result=await h.gateway.execute('1',addr,q,s=>{assert(/^0x[0-9a-f]{64}$/.test(s.hash));purpose=s.purpose;recorded=true;});
 assert.equal(purpose,'action');assert.equal(result.filled,'0');assert.equal(result.cash,'0');
});
test('interrupted actions reconcile only their journaled receipt and owner',async()=>{
 const h=harness(),q=await h.gateway.quote('buy',h.market,'Up','10',addr);
 const a:Action={id:'1',userId:'1',quote:q,state:'unknown',createdAt:Date.now(),submissions:[{hash:`0x${'c'.repeat(64)}`,target:q.market.pool,purpose:'action'}]};
 Object.assign(h.gateway.public,{getTransactionReceipt:async()=>({status:'success',from:addr,to:q.market.pool,logs:[],transactionHash:a.submissions![0].hash})});
 const recovered=await h.gateway.reconcile(addr,a);assert.equal(recovered?.state,'confirmed');assert.equal(recovered?.result?.filled,'0');
 await assert.rejects(()=>h.gateway.reconcile(`0x${'2'.repeat(40)}`,a),/identity mismatch/);
});
test('leaderboard includes later maker fills only for the user’s bot-created orders',async()=>{
 const h=harness(),q=await h.gateway.quote('limit',h.market,'Up','10',addr,'0.40');
 const a:Action={id:'1',userId:'1',quote:q,state:'confirmed',createdAt:Date.now(),result:{hash:`0x${'c'.repeat(64)}`,filled:'0',cash:'0',orderId:'5',summary:'Resting'}};
 Object.assign(h.gateway.exchange.client,{getUserFills:async(_address:string,opts:any)=>{
  assert.deepEqual(opts.markets,[q.market.id]);
  return [
   {market:q.market.id,makerOrderId:'5',maker:addr,fillPrice:'400000',quantity:'2000000',txHash:'tx-a'},
   {market:q.market.id,makerOrderId:'5',maker:addr,fillPrice:'400000',quantity:'4000000',txHash:'tx-a'},
   {market:q.market.id,makerOrderId:'6',maker:addr,fillPrice:'400000',quantity:'5000000',txHash:'tx-b'},
  ];
 }});
 assert.deepEqual(await h.gateway.makerStats(addr,[a]),{volume:2.4000000000000004,trades:1,complete:true});
});
