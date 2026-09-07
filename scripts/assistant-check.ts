/** Read-only chain/indexer/quote check. Never creates a signer or sends a transaction. */
import { DreamDex, PreflightError } from '../src/assistant/dreamdex.js';
import type { Wallets } from '../src/assistant/wallets.js';
import { settings, chain } from '../src/assistant/settings.js';
import { zeroAddress } from 'viem';
const dex=new DreamDex({privateKey(){throw new Error('Read-only check cannot sign');}} as unknown as Wallets);
try{
 const chainId=await dex.public.getChainId();if(chainId!==chain.id)throw new Error('Wrong chain');
 console.log(`PASS Somnia testnet chain ${chainId}`);
 const balances=await dex.balances(zeroAddress);console.log(`PASS collateral contract ${settings.collateral}; decimals=${balances.decimals}`);
 let count=0, offset:number|null=0;
 for(let page=0;page<3&&offset!==null;page++){
  const rows=await dex.markets(offset);offset=rows.next;
  console.log(`PASS market page ${page+1}: ${rows.markets.length} tradable markets; next=${offset}`);
  for(const m of rows.markets.slice(0,3)){
   count++;
   for(const side of ['Up','Down'] as const) {
    if((side==='Up'?m.upAsk:m.downAsk)===null)continue;
    try {
     const q=await dex.quote('buy',m,side,'10',zeroAddress);
     if(BigInt(q.maxCost)>10n*10n**BigInt(m.decimals))throw new Error('Quote exceeds budget');
     console.log(`PASS ${m.asset} ${side} quote: ${q.quantity} raw shares; max cost ${q.maxCost}`);
    } catch(e) {
     if(e instanceof PreflightError && /No liquidity|closing or has closed/.test(e.message))console.log(`SKIP ${m.asset} ${side}: market moved during the read`);
     else throw e;
    }
   }
  }
  if(count)break;
 }
 if(!count)console.log('SKIP live quote checks: no tradable markets in first three pages.');
}catch(e){console.error('FAIL',e instanceof Error?e.message:'Unknown error');process.exitCode=1;}
finally{dex.close();process.exit(process.exitCode ?? 0);}
