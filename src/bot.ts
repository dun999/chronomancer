import { Telegraf, Markup, type Context } from 'telegraf';
import { formatUnits } from 'viem';
import { pathToFileURL } from 'node:url';
import { settings } from './assistant/settings.js';
import { Ledger } from './assistant/ledger.js';
import { Wallets } from './assistant/wallets.js';
import { DreamDex, PreflightError } from './assistant/dreamdex.js';
import { askAgent } from './assistant/agent.js';
import { escape, positionCard } from './assistant/cards.js';
import { money } from './assistant/math.js';
import type { ActionKind, MarketView, Side } from './assistant/types.js';

type Session = {
  selected?: {marketId: string; side: Side};
  awaiting?: {marketId: string; side: Side; kind: ActionKind};
  history: Array<{role:'user'|'assistant';content:string}>;
  marketIds: string[]; lastAi?: number;
};
type Ref = {op:string; marketId?:string; side?:Side; kind?:ActionKind; amount?:string; page?:number; actionId?:string; orderId?:string};
type Services = {ledger: Ledger; wallets: Wallets; dex: DreamDex; agent: typeof askAgent};
const uid = (ctx: Context) => String(ctx.from!.id);
const keyboard = (rows: ReturnType<typeof Markup.button.callback>[][]) => ({parse_mode:'HTML' as const,...Markup.inlineKeyboard(rows)});
const fmt = (raw: string, m: MarketView) => formatUnits(BigInt(raw),m.decimals);
const odds = (raw: string|null, m: MarketView) => raw === null ? 'no asks' : `${(Number(fmt(raw,m))*100).toFixed(1)}¢`;

export function buildBot(injected?: Services, token = settings.token) {
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN before starting the bot.');
  const ledger = injected?.ledger ?? new Ledger(settings.dataDir);
  const wallets = injected?.wallets ?? new Wallets(ledger,settings.dataDir,settings.masterKey);
  const dex = injected?.dex ?? new DreamDex(wallets);
  const agent = injected?.agent ?? askAgent;
  const bot = new Telegraf(token);
  const busy = new Set<string>();
  const session = (id: string) => ledger.session<Session>(id,{history:[],marketIds:[]});
  const button = (id:string, title:string, ref:Ref) => Markup.button.callback(title,`r:${ledger.ref(id,ref)}`);
  const user = (ctx:Context) => wallets.ensure(uid(ctx),ctx.from!.first_name);

  bot.use(async (ctx,next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    if (ctx.chat?.type !== 'private') { await ctx.reply('Open a private chat with me to create your wallet and trade.'); return; }
    if (busy.has(uid(ctx))) { if (ctx.callbackQuery) await ctx.answerCbQuery('Still working on your previous request.'); return; }
    if (!ledger.claimUpdate(ctx.update.update_id)) return;
    busy.add(uid(ctx));
    try { await next(); }
    catch(e) {
      await ctx.reply(e instanceof PreflightError ? e.message : 'That request could not be completed. Check /activity for transaction status, or try the read again.').catch(()=>undefined);
      // Do not print provider responses, Telegram URLs, private keys or signed transactions.
      console.error('Bot request failed:', e instanceof Error ? e.name : 'UnknownError');
    } finally { busy.delete(uid(ctx)); }
  });
  async function wallet(ctx:Context) {
    const u = user(ctx), b = await dex.balances(u.address);
    await ctx.reply(`<b>Your Somnia testnet wallet</b>\n<code>${u.address}</code>\n\nGas: <b>${formatUnits(b.stt,18)} STT</b>\nTrading: <b>${formatUnits(b.collateral,b.decimals)} tUSDC</b>\n\nSend STT for gas and tUSDC for settlement to this address on Somnia Shannon (50312). These are test tokens, not real dollars.`, {
      parse_mode:'HTML',...Markup.inlineKeyboard([
        [Markup.button.url('Get STT',settings.faucet),Markup.button.url('tUSDC faucet group',settings.collateralFaucet)],
        [button(u.id,'I topped up · check balance',{op:'funded'})],
        [Markup.button.url('View wallet',`${settings.explorer}/address/${u.address}`)],
      ]),
    });
  }
  async function onboarding(ctx:Context, stage:number) {
    const u = user(ctx); ledger.stage(u.id,stage);
    if (stage === 1) await ctx.reply('<b>DreamDEX, in simple words</b>\n\nPick Up or Down for a price event. You buy shares using tUSDC. After resolution, a winning share can be claimed for 1 tUSDC; a losing share pays 0. A void normally pays 0.5 per side.\n\nYour maximum trade loss is what you spend, plus gas.',keyboard([[button(u.id,'Continue → What makes it different?',{op:'intro',page:2})]]));
    else if (stage === 2) await ctx.reply('<b>Why DreamDEX feels different</b>\n\nYour orders match on an on-chain order book. Prices come from traders, and trades and payouts are verifiable on Somnia.\n\nOne complete set holds an Up and a Down share backed by 1 tUSDC. You can buy, sell before close if there is liquidity, or claim after settlement.\n\nI help you understand the choices. You approve a specific trade before I place it.',keyboard([[button(u.id,'Continue → Fund my wallet',{op:'wallet'})]]));
  }
  bot.start(async ctx=>{
    const u = user(ctx); const checked = ledger.checkIn(u.id);
    await ctx.reply(`<b>Welcome to Chronomancer ✨</b>\nYour prediction-market sidekick on Telegram.\n\nYour Somnia testnet wallet is ready:\n<code>${u.address}</code>\n\nThis bot holds the encrypted key and signs trades you confirm. Fund with test tokens only.\n\n🔥 ${checked.streak}-day check-in streak. Let’s get you started.`,keyboard([
      [button(u.id,'Continue → Meet DreamDEX',{op:'intro',page:1})],
      ...(u.stage>=2 ? [[button(u.id,'Open markets',{op:'markets',page:0})]] : []),
    ]));
  });
  async function marketList(ctx:Context,page=0) {
    const u = user(ctx);
    await ctx.reply('Checking open DreamDEX markets…');
    const result = await dex.markets(page), s = session(u.id);
    s.marketIds = result.markets.map(m=>m.id); ledger.setSession(u.id,s);
    const lines = result.markets.map((m,i)=>`<b>${i+1}. ${escape(m.asset)} · ${new Date(m.expiry*1000).toISOString().slice(11,16)} UTC</b>\n${escape(m.question.slice(0,150))}\nUp ${odds(m.upAsk,m)} · Down ${odds(m.downAsk,m)} · ${m.id.slice(0,10)}…`);
    const rows = result.markets.map(m=>[button(u.id,`${m.asset} · ${new Date(m.expiry*1000).toISOString().slice(11,16)} UTC · ${m.id.slice(2,8)}`,{op:'market',marketId:m.id})]);
    if (result.next !== null) rows.push([button(u.id,'Next markets →',{op:'markets',page:result.next})]);
    rows.push([button(u.id,'↻ Refresh',{op:'markets',page:0})]);
    await ctx.reply(`<b>Open markets · tUSDC</b>\n\n${lines.join('\n\n') || 'No tradable markets on this page. Check the next page or refresh shortly.'}\n\nPrices are current asks, not AI confidence. Tap a market, or ask “find a good opportunity.”`,keyboard(rows));
  }
  async function marketDetail(ctx:Context,id:string) {
    const u = user(ctx), m = await dex.market(id);
    await ctx.reply(`<b>${escape(m.asset)} · Choose your side</b>\n${escape(m.question)}\n\nUp: ${odds(m.upAsk,m)}\nDown: ${odds(m.downAsk,m)}\nCloses: ${new Date(m.expiry*1000).toISOString()}\nMarket: <code>${m.id}</code>\n\nYou’ll review the budget and price limit before placing a trade.`,keyboard([
      [button(u.id,'↗ Buy Up',{op:'amount',marketId:id,side:'Up',kind:'buy'}),button(u.id,'↘ Buy Down',{op:'amount',marketId:id,side:'Down',kind:'buy'})],
      [button(u.id,'Advanced · complete sets / limit orders',{op:'advanced',marketId:id})],
      [button(u.id,'← All markets',{op:'markets',page:0})],
    ]));
  }
  async function amountPrompt(ctx:Context,ref:Ref) {
    const u=user(ctx), s=session(u.id);
    s.selected={marketId:ref.marketId!,side:ref.side ?? 'Up'};
    s.awaiting={...s.selected,kind:ref.kind ?? 'buy'}; ledger.setSession(u.id,s);
    await ctx.reply(ref.kind==='limit' ? 'Send a tUSDC budget and a limit price, for example: 10 0.45. This is a post-only buy; an unfilled order can rest for up to 5 minutes.' :
      `How much ${['sell','merge'].includes(ref.kind ?? '') ? 'in shares' : 'tUSDC'}? Send a number, or choose below.`,keyboard([
        ...(ref.kind==='limit' ? [] : [[button(u.id,'10',{...ref,op:'quote',amount:'10'}),button(u.id,'25',{...ref,op:'quote',amount:'25'}),button(u.id,'50',{...ref,op:'quote',amount:'50'})]]),
        [button(u.id,'Cancel',{op:'dismiss'})],
      ]));
  }
  async function review(ctx:Context,ref:Ref,limitPrice?:string) {
    const u=user(ctx), m=await dex.market(ref.marketId!,!['redeem','cancel'].includes(ref.kind!));
    const q=await dex.quote(ref.kind ?? 'buy',m,ref.side ?? 'Up',ref.amount ?? '0',u.address,limitPrice,ref.orderId);
    const action=ledger.prepare(u.id,q), s=session(u.id); delete s.awaiting; ledger.setSession(u.id,s);
    const sidePrice=q.side==='Up' ? BigInt(q.price) : 10n**BigInt(m.decimals)-BigInt(q.price);
    const body=['buy','limit'].includes(q.kind) ? `Budget: <b>${escape(q.amount)} tUSDC</b>\nMaximum reserved cost: ${fmt(q.maxCost,m)} tUSDC\nUp to ${fmt(q.quantity,m)} ${q.side} shares\nPrice ceiling: ${formatUnits(sidePrice,m.decimals)} tUSDC/share\n${q.kind==='limit'?'Post-only · rests up to 5 minutes. Manage with /orders.':'Immediate-or-cancel · partial fills are possible.'}` :
      q.kind==='sell' ? `Sell up to ${fmt(q.quantity,m)} ${q.side} shares\nPrice floor: ${formatUnits(sidePrice,m.decimals)} tUSDC/share\nPartial fills are possible; proceeds depend on actual fills.` :
      q.kind==='mint' ? `Deposit ${fmt(q.quantity,m)} tUSDC → ${fmt(q.quantity,m)} Up + ${fmt(q.quantity,m)} Down.` :
      q.kind==='merge' ? `Merge ${fmt(q.quantity,m)} of EACH side → ${fmt(q.quantity,m)} tUSDC.` :
      q.kind==='redeem' ? `Claim ${fmt(q.quantity,m)} ${q.side} shares at the contract’s settlement payout.` :
      `Cancel order ${escape(q.orderId!)}. Remaining escrow returns to your wallet.`;
    await ctx.reply(`<b>Review ${q.kind} · ${escape(m.asset)}</b>\n${escape(m.question.slice(0,140))}\nMarket: <code>${m.id}</code>\n\n${body}\n\nSTT gas is additional. First use may also require contract approvals. Quote expires in ${Math.max(0,Math.ceil((q.expiresAt-Date.now())/1000))} seconds.\nSomnia testnet · test tokens only.`,keyboard([
      [button(u.id,'Confirm transaction',{op:'confirm',actionId:action.id}),button(u.id,'Cancel',{op:'cancel',actionId:action.id})],
    ]));
  }
  async function confirm(ctx:Context,id:string) {
    const u=user(ctx); let a;
    try { a=ledger.claim(id,u.id); } catch(e) { await ctx.reply((e as Error).message); return; }
    await ctx.reply('Submitting your confirmed transaction to Somnia…').catch(()=>undefined);
    let result;
    try {
      result=await dex.execute(u.id,u.address,a.quote,submission=>ledger.recordSubmission(id,u.id,submission));
      ledger.finish(id,u.id,'confirmed',result);
    } catch(e) {
      const known=e instanceof PreflightError || (e as Error).name==='ContractRevertError';
      ledger.finish(id,u.id,known?'failed':'unknown',undefined,known?'Preflight failed or transaction reverted':'Submission outcome needs reconciliation');
      await ctx.reply(e instanceof PreflightError ? e.message : known ? 'The contract rejected this transaction. No fill was recorded. Check /activity.' :
        'I could not verify the transaction outcome. I won’t resend it. Further trades are paused until the transaction is reconciled. Check /activity and your wallet explorer.');
      return;
    }
    // Persist success before sending Telegram; a delivery failure can never trigger a second trade.
    await ctx.reply(`<b>Confirmed, ser ✓</b>\n${escape(result.summary)}\n\nTransaction:\n<code>${result.hash}</code>\n\n/positions for your shares · /activity for receipts`,{
      parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.url('View real testnet transaction',`${settings.explorer}/tx/${result.hash}`)]]),
    });
  }
  async function positions(ctx:Context,page=0) {
    const u=user(ctx); const found:Array<{marketId:string;side:Side;label:string}>=[];
    for (const a of ledger.actions(u.id).filter(a=>a.state==='confirmed')) {
      const q=a.quote;
      if (['cancel','redeem'].includes(q.kind) || (['buy','sell','limit'].includes(q.kind) && Number(a.result?.filled ?? 0) === 0)) continue;
      for(const side of (['mint','merge'].includes(q.kind)?['Up','Down']:[q.side]) as Side[])
        if (!found.some(p=>p.marketId===q.market.id&&p.side===side)) found.push({marketId:q.market.id,side,label:`${q.market.asset} ${side} · ${q.market.id.slice(2,8)}`});
    }
    let lag=false;
    try {
      for(const p of await dex.portfolio(u.address)) for(const side of ['Up','Down'] as Side[]) {
        if ((side==='Up'?p.balanceYes:p.balanceNo)>0n && !found.some(x=>x.marketId===p.market.id&&x.side===side))
          found.push({marketId:p.market.id,side,label:`${p.market.asset} ${side} · ${p.market.id.slice(2,8)}`});
      }
    } catch { lag=true; }
    const slice=found.slice(page,page+5);
    await ctx.reply(`<b>Which position?</b>\n${slice.length?'Your five most recent positions on this page. Tap for on-chain shares and P/L.':'No positions found yet. Start with /market.'}${lag?'\nIndexer unavailable; showing the bot’s recorded positions.':''}`,keyboard([
      ...slice.map(p=>[button(u.id,p.label,{op:'position',marketId:p.marketId,side:p.side})]),
      ...(page+5<found.length?[[button(u.id,'Older positions →',{op:'positions',page:page+5})]]:[]),
    ]));
  }
  async function position(ctx:Context,ref:Ref) {
    const u=user(ctx), p=await dex.position(u.address,ref.marketId!,ref.side!);
    await ctx.replyWithPhoto({source:positionCard(p,u.streak)}, {caption:
      `${p.market.asset} ${p.side} · ${p.status}\nShares: ${fmt(p.balance,p.market)}\nUnrealized P/L: ${money(p.pnl,p.market.decimals,true)} tUSDC\nRealized P/L from sells: ${money(p.realized,p.market.decimals,true)} tUSDC\n${p.indexed?'Indexed average-cost estimate, excludes gas.':'Indexer catching up; P/L unavailable.'}`,
      ...Markup.inlineKeyboard([
        [button(u.id,'Sell shares',{op:'amount',marketId:ref.marketId,side:ref.side,kind:'sell'}),button(u.id,'Claim payout',{op:'quote',marketId:ref.marketId,side:ref.side,kind:'redeem',amount:'0'})],
        [button(u.id,'↻ Refresh position',ref)],
      ]),
    });
  }
  async function activity(ctx:Context,page=0) {
    const u=user(ctx);
    for (const a of ledger.actions(u.id).filter(a=>a.state==='unknown'||a.state==='executing')) {
      const recovered=await dex.reconcile(u.address,a);
      if(recovered)ledger.finish(a.id,u.id,recovered.state,recovered.result,recovered.state==='failed'?'Transaction reverted':undefined);
    }
    const all=ledger.actions(u.id), items=all.slice(page,page+8);
    await ctx.reply(`<b>Your activity</b>\n\n${items.map(a=>`${a.state==='confirmed'?'✓':a.state==='unknown'?'⚠':'·'} <b>${a.state}</b> · ${a.quote.kind} ${escape(a.quote.market.asset)} ${a.quote.side}\n${new Date(a.createdAt).toISOString()}\n${a.result?`${escape(a.result.summary)}\n<a href="${settings.explorer}/tx/${a.result.hash}">Transaction receipt</a>`:escape(a.error ?? 'No confirmed transaction') + (a.submissions ?? []).map(t=>`\n<a href="${settings.explorer}/tx/${t.hash}">${t.purpose} transaction</a>`).join('')}\nRef: <code>${a.id}</code>`).join('\n\n') || 'Nothing here yet. Your confirmed trades will appear here.'}`,keyboard([
      ...(page+8<all.length?[[button(u.id,'Older activity →',{op:'activity',page:page+8})]]:[]),
    ]));
  }
  async function leaderboard(ctx:Context,page=0) {
    let incomplete=false;
    const rows=(await Promise.all(ledger.users().map(async u=>{
      const all=ledger.actions(u.id);
      const actions=all.filter(a=>a.state==='confirmed'&&['buy','sell','limit'].includes(a.quote.kind));
      let volume=actions.reduce((sum,a)=>sum+Number(a.result?.cash ?? 0),0);
      let trades=actions.filter(a=>Number(a.result?.filled ?? 0)>0).length;
      try {const maker=await dex.makerStats(u.address,all);volume+=maker.volume;trades+=maker.trades;if(!maker.complete)incomplete=true;}
      catch {incomplete=true;}
      return {u,volume,trades};
    }))).filter(x=>x.trades>0).sort((a,b)=>b.volume-a.volume || b.u.xp-a.u.xp);
    await ctx.reply(`<b>DreamDEX crew 🏆</b>\nRanked by bot fill volume (before fees), not profit. Includes indexed maker fills on resting orders. Pseudonyms protect Telegram identities.${incomplete?' Some maker history is unavailable or truncated; totals are partial.':''}\n\n${rows.slice(page,page+10).map((r,i)=>`${page+i+1}. Trader ${r.u.address.slice(2,8)} · ${r.volume.toFixed(2)} tUSDC\n${r.trades} filled transactions · ${r.u.streak} day streak`).join('\n\n')||'The leaderboard starts with the first filled trade.'}`,keyboard([
      ...(page+10<rows.length?[[button(uid(ctx),'Next traders →',{op:'leaderboard',page:page+10})]]:[]),
    ]));
  }
  async function orders(ctx:Context) {
    const u=user(ctx), rows=await dex.openOrders(u.address);
    await ctx.reply('<b>Your open orders</b>\n'+(rows.length?'Choose an order to review cancellation. Indexed data may lag.':'No resting orders found.'),keyboard(rows.slice(0,20).map(o=>[
      button(u.id,`${o.marketInfo?.asset ?? 'Market'} ${o.side} · order ${o.orderId}`,{op:'quote',kind:'cancel',marketId:o.market,orderId:o.orderId,amount:'0',side:o.side?.includes('NO')?'Down':'Up'}),
    ])));
  }
  async function redeem(ctx:Context) {
    const u=user(ctx), rows=await dex.claimable(u.address);
    await ctx.reply('<b>Ready to claim</b>\n'+(rows.length?'Choose a payout to review. Voided markets can pay both sides.':'No indexed payouts to claim yet. You can also open a position and tap Claim payout.'),keyboard(rows.slice(0,20).map(r=>[
      button(u.id,`${r.marketId.slice(0,10)}… ${r.outcomeIdx===0?'Up':'Down'}`,{op:'quote',kind:'redeem',marketId:r.marketId,side:r.outcomeIdx===0?'Up':'Down',amount:'0'}),
    ])));
  }
  async function advanced(ctx:Context,marketId?:string) {
    if(!marketId){await ctx.reply('Open /market, select a market, then tap Advanced. You can mint/merge complete sets or place post-only limit buys. /orders manages resting quotes; position cards let you sell or redeem.');return;}
    const id=uid(ctx);
    await ctx.reply('<b>DreamDEX tools</b>\nMint: 1 tUSDC → 1 Up + 1 Down.\nMerge: 1 Up + 1 Down → 1 tUSDC.\nLimit: place a post-only buy at your chosen price.\n\nEvery action has a review before signing.',keyboard([
      [button(id,'Mint complete sets',{op:'amount',marketId,kind:'mint',side:'Up'}),button(id,'Merge complete sets',{op:'amount',marketId,kind:'merge',side:'Up'})],
      [button(id,'Limit buy Up',{op:'amount',marketId,kind:'limit',side:'Up'}),button(id,'Limit buy Down',{op:'amount',marketId,kind:'limit',side:'Down'})],
    ]));
  }
  bot.command(['market','markets','play'],ctx=>marketList(ctx));
  bot.command(['wallet','vault'],wallet);
  bot.command(['positions','position','scrolls'],ctx=>positions(ctx));
  bot.command('activity',ctx=>activity(ctx));
  bot.command(['leaderboard','leaders'],ctx=>leaderboard(ctx));
  bot.command('orders',orders);
  bot.command('redeem',redeem);
  bot.command('advanced',ctx=>advanced(ctx));
  bot.command(['how','help'],ctx=>ctx.reply('✨ Chronomancer · your DreamDEX sidekick\n\n/start — wallet + guided introduction\n/wallet — balance and funding\n/market — browse open markets\n/positions — last five positions + P/L cards\n/activity — your transaction history\n/leaderboard — the crew’s confirmed trading volume\n/daily — daily check-in streak\n/orders — manage resting orders\n/redeem — claim settled payouts\n/advanced — complete sets and limit orders\n\nOr ask: “Find a good opportunity”, “10 tUSDC Up on this market”, or “Could you check my position?”\n\nTestnet only. Check-ins earn XP; trading more does not extend your streak.'));
  bot.command('daily',async ctx=>{const u=user(ctx), c=ledger.checkIn(u.id);await ctx.reply(`🔥 ${c.streak}-day streak · ${c.xp} XP\nDaily check-ins reset at 00:00 UTC. Come back tomorrow—no trade required.`);});
  bot.action(/^r:([a-f0-9]+)$/,async ctx=>{
    await ctx.answerCbQuery();
    const ref=ledger.resolveRef<Ref>(ctx.match[1],uid(ctx));
    if(!ref){await ctx.reply('This button expired or belongs to another user. Open /market for a fresh view.');return;}
    switch(ref.op){
      case'intro':return onboarding(ctx,ref.page!);
      case'wallet':return wallet(ctx);
      case'funded':{
        const u=user(ctx),b=await dex.balances(u.address);
        if(b.stt<10n**16n||b.collateral<=0n){await ctx.reply('Still waiting for funding. You need at least 0.01 STT for gas and a positive tUSDC balance.');return wallet(ctx);}
        ledger.stage(u.id,3);await ctx.reply('You’re funded ✨ Browse /market or ask me to look for an opportunity.');return;
      }
      case'markets':return marketList(ctx,ref.page);
      case'market':return marketDetail(ctx,ref.marketId!);
      case'amount':return amountPrompt(ctx,ref);
      case'quote':return review(ctx,ref);
      case'confirm':return confirm(ctx,ref.actionId!);
      case'cancel':ledger.cancel(ref.actionId!,uid(ctx));await ctx.reply('Cancelled. No transaction submitted by this confirmation.');return;
      case'dismiss':{const s=session(uid(ctx));delete s.awaiting;ledger.setSession(uid(ctx),s);await ctx.reply('All good. /market whenever you’re ready.');return;}
      case'positions':return positions(ctx,ref.page);
      case'position':return position(ctx,ref);
      case'activity':return activity(ctx,ref.page);
      case'leaderboard':return leaderboard(ctx,ref.page);
      case'advanced':return advanced(ctx,ref.marketId);
    }
  });
  bot.on('text',async ctx=>{
    const u=user(ctx), text=ctx.message.text.trim(), s=session(u.id);
    if(/\b(check|show|my)\b.*\bpositions?\b/i.test(text)) return positions(ctx);
    if(/^\/|^help$/i.test(text)){await ctx.reply('Use /help to see the commands.');return;}
    if(s.awaiting && /^\$?\d+(\.\d+)?(?:\s+\d+(\.\d+)?)?$/.test(text)){
      const [amount,price]=text.replace(/^\$/,'').split(/\s+/);
      return review(ctx,{op:'quote',...s.awaiting,amount},price);
    }
    // A simple explicit budget on the selected market works without an LLM.
    const budget=text.match(/(?:\$\s*(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:t?usdc)\b)/i);
    if(s.selected && budget && /^(?:yes[, ]+)?(?:please[, ]+)?\$?\d+(?:\.\d+)?\s*(?:t?usdc)?(?:\s+(?:on\s+)?(?:this market|it))?(?:\s+(?:up|down))?[.!]?$/i.test(text)){
      const side=/\bdown\b/i.test(text)?'Down':/\bup\b/i.test(text)?'Up':s.selected.side;
      return review(ctx,{op:'quote',kind:'buy',marketId:s.selected.marketId,side,amount:budget[1]??budget[2]});
    }
    if(Date.now()-(s.lastAi??0)<8000){await ctx.reply('Give me a few seconds before the next AI request.');return;}
    s.lastAi=Date.now();ledger.setSession(u.id,s);
    await ctx.reply('Let me check the current markets…');
    const {markets}=await dex.markets(0);
    if(s.selected && !markets.some(m=>m.id===s.selected!.marketId)){
      try{markets.push(await dex.market(s.selected.marketId));}catch{/* stale context does not force a market */}
    }
    let d;
    try{d=await agent(text,markets,s.history,s.selected);}catch(e){await ctx.reply(settings.aiKey&&settings.aiModel?'The AI is unavailable right now. /market and /positions still work.': 'AI is not configured yet. You can still use /market and trade with buttons, or check /positions.');return;}
    s.history=[...s.history,{role:'user',content:text},{role:'assistant',content:d.reply}].slice(-8) as Session['history'];
    ledger.setSession(u.id,s);
    if(d.intent==='positions')return positions(ctx);
    if(d.intent==='activity')return activity(ctx);
    if(d.intent==='markets')return marketList(ctx);
    if(d.intent==='buy'&&d.marketId&&d.side&&d.amount){
      // Even AI-originated amounts must occur in the user's own message.
      if(!budget || Number(budget[1]??budget[2])!==Number(d.amount)){await ctx.reply('How much tUSDC would you like to use? Include the amount in your message.');return;}
      return review(ctx,{op:'quote',marketId:d.marketId,side:d.side,kind:'buy',amount:d.amount});
    }
    await ctx.reply(escape(d.reply),{parse_mode:'HTML'});
    for(const p of d.picks){
      const m=markets.find(m=>m.id===p.marketId);if(!m)continue;
      if((p.side==='Up'?m.upAsk:m.downAsk)===null)continue;
      await ctx.reply(`<b>${escape(m.asset)} · ${p.side}</b>\n${escape(p.reason)}\n\nConviction: ${p.conviction} · AI opinion, not a calibrated win probability.\n${p.evidence.map(url=>`<a href="${escape(url)}">Evidence</a>`).join(' · ')}\n\nWant to review an entry?`,keyboard([[button(u.id,`Review ${p.side} entry`,{op:'amount',kind:'buy',marketId:m.id,side:p.side})]]));
    }
    if(d.picks[0]){s.selected={marketId:d.picks[0].marketId,side:d.picks[0].side};ledger.setSession(u.id,s);}
  });
  return {bot, close:()=>{dex.close();ledger.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const runtime=buildBot();
  process.once('SIGINT',()=>{runtime.bot.stop('SIGINT');runtime.close();process.exit(0);});
  process.once('SIGTERM',()=>{runtime.bot.stop('SIGTERM');runtime.close();process.exit(0);});
  runtime.bot.launch(() => {
    console.log(`Telegram connected: @${runtime.bot.botInfo?.username}; AI: ${settings.aiProvider}/${settings.aiModel}`);
  }).catch(()=>{console.error('Telegram launch failed. Check token/network and ensure only one polling instance runs.');runtime.close();process.exitCode=1;});
}
