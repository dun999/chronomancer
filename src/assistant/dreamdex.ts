import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, isBinaryMarket, ORDER_TYPE, orderBookEventsAbi, type PlaceOrderResult, type OrderFill } from '@somnia-chain/markets-sdk';
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, isAddress, zeroAddress, decodeEventLog, keccak256, erc20Abi, formatUnits, http, parseAbi, type Account, type Address, type Hex } from 'viem';
import { settings, chain } from './settings.js';
import { privateKeyToAccount } from 'viem/accounts';
import { Wallets } from './wallets.js';
import { units, sizeBudget, receiptFills } from './math.js';
import type { Action, ActionKind, Execution, MarketView, PositionView, Quote, TransferQuote, Side } from './types.js';

const poolAbi = parseAbi([
  'function getBinaryPoolParams() view returns ((address collateralToken, address market, address outcomeToken, uint256 yesId, uint256 noId, uint256 oneCollateral, uint256 setBacking, address feeRecipient, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 maxBuilderFeeBpsTimes1k, uint256 settlementFeeBpsTimes1k, address settlement, uint64 marketNonce, bool finalized))',
]);
export class PreflightError extends Error {}
export class DreamDex {
  readonly public = createPublicClient({ chain, transport: http(settings.rpcUrl, { timeout: 15000, retryCount: 1 }) });
  readonly exchange = this.makeExchange();
  constructor(private wallets: Wallets) {}
  private makeExchange(account?: Account) {
    return new SomniaMarkets({ chain, addresses: SOMNIA_TESTNET_ADDRESSES, wsRpcUrl: settings.wsRpcUrl,
      indexerUrl: settings.indexerUrl, account });
  }
  close() { this.exchange.close(); }
  async balances(address: Address) {
    const [stt, collateral, decimals] = await Promise.all([
      this.public.getBalance({address}),
      this.public.readContract({address: settings.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [address]}),
      this.public.readContract({address: settings.collateral, abi: erc20Abi, functionName: 'decimals'}),
    ]);
    return {stt, collateral, decimals};
  }
  async transferQuote(address: Address, recipient: string, amount: string): Promise<TransferQuote> {
    if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress || recipient.toLowerCase() === address.toLowerCase())
      throw new PreflightError('Enter a valid destination wallet different from this wallet and the zero address.');
    let quantity: bigint;
    try { quantity = units(amount, 6); } catch { throw new PreflightError('Use a positive tUSDC amount with at most 6 decimals.'); }
    if (quantity > units(settings.maxBudget, 6)) throw new PreflightError('The testnet transfer limit is 100 tUSDC per action.');
    if (await this.public.getChainId() !== chain.id) throw new PreflightError('RPC is not Somnia testnet. Transfer stopped.');
    const b = await this.balances(address);
    if (b.decimals !== 6 || b.collateral < quantity) throw new PreflightError('Not enough available tUSDC, or unexpected token decimals. Close or claim positions first.');
    if (b.stt < 10n ** 16n) throw new PreflightError('Keep at least 0.01 STT for gas.');
    return {kind:'withdraw', asset:'tUSDC', recipient:getAddress(recipient), token:settings.collateral,
      chainId:50312, amount, quantity:quantity.toString(), decimals:6, expiresAt:Date.now()+60_000};
  }
  private transferReceipt(address: Address, q: TransferQuote, receipt: {transactionHash:Hex; logs: readonly {address:string;data:Hex;topics:readonly Hex[]}[]}): Execution {
    const paid = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== q.token.toLowerCase()) return false;
      try {
        const event = decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics as [Hex,...Hex[]]});
        return event.eventName === 'Transfer' && event.args.from.toLowerCase() === address.toLowerCase()
          && event.args.to.toLowerCase() === q.recipient.toLowerCase() && event.args.value === BigInt(q.quantity);
      } catch { return false; }
    });
    if (!paid) throw new Error('Transfer receipt did not contain the reviewed token payment. Check /activity.');
    return {hash:receipt.transactionHash,filled:'0',cash:formatUnits(BigInt(q.quantity),6),
      summary:`Sent ${formatUnits(BigInt(q.quantity),6)} tUSDC to ${q.recipient} on Somnia Shannon testnet.`};
  }
  private transferWallet(account: Account) {
    return createWalletClient({account,chain,transport:http(settings.rpcUrl,{retryCount:0})});
  }
  private async executeTransfer(userId: string, address: Address, q: TransferQuote, journal?: (s: NonNullable<Action['submissions']>[number])=>void): Promise<Execution> {
    let gas: bigint;
    try {
      if (q.expiresAt <= Date.now()) throw new Error('Transfer review expired. Request a new one.');
      if (q.chainId !== 50312 || q.token.toLowerCase() !== settings.collateral.toLowerCase() || q.decimals !== 6 || q.asset !== 'tUSDC') throw new Error('Unsupported transfer token or network.');
      const fresh = await this.transferQuote(address,q.recipient,q.amount);
      if (fresh.quantity !== q.quantity) throw new Error('Transfer amount changed. Request a new review.');
      const call = {address:q.token,abi:erc20Abi,functionName:'transfer' as const,args:[q.recipient,BigInt(q.quantity)] as const,account:address};
      const simulation = await this.public.simulateContract(call);
      if (simulation.result !== true) throw new Error('Token transfer simulation failed.');
      gas = (await this.public.estimateContractGas(call)) * 12n / 10n;
    } catch(e) { throw new PreflightError((e as Error).message); }
    const account = privateKeyToAccount(this.wallets.privateKey(userId));
    if (account.address.toLowerCase() !== address.toLowerCase()) throw new PreflightError('Wallet identity mismatch.');
    const wallet = this.transferWallet(account);
    let request;
    try {
      request = await wallet.prepareTransactionRequest({to:q.token,gas,
        data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[q.recipient,BigInt(q.quantity)]})});
    } catch { throw new PreflightError('Could not prepare transfer fees and nonce. No transfer was sent. Try again.'); }
    const balance = await this.public.getBalance({address}).catch(()=>{throw new PreflightError('Could not verify STT gas balance. No transfer was sent.');});
    const gasPrice = request.maxFeePerGas ?? request.gasPrice;
    if (gasPrice === undefined || balance < gas * gasPrice + 10n ** 16n) throw new PreflightError('Not enough STT for this transfer plus the 0.01 STT gas reserve.');
    if (q.expiresAt <= Date.now()) throw new PreflightError('Transfer review expired. Request a new one.');
    const signed = await wallet.signTransaction(request);
    const hash = keccak256(signed);
    journal?.({hash,target:q.token,purpose:'action'});
    await this.public.sendRawTransaction({serializedTransaction:signed});
    const receipt = await this.public.waitForTransactionReceipt({hash,timeout:60_000});
    if (receipt.status !== 'success') throw Object.assign(new Error('Token transfer reverted'),{name:'ContractRevertError'});
    return this.transferReceipt(address,q,receipt);
  }
  /** Read-only exit choices. Every button subsequently creates a fresh review. */
  async exitOptions(address: Address, marketId: string, side: Side) {
    const market = await this.market(marketId, false);
    const oc = await this.exchange.client.getMarketOnchain(market.id);
    const [up,down] = await Promise.all([oc.yesId,oc.noId].map(id =>
      this.exchange.client.getOutcomeBalance({outcomeToken:oc.outcomeToken,account:address,id})));
    const held = side === 'Up' ? up : down;
    const cap = units(settings.maxBudget,market.decimals);
    const quantity = held < cap ? held : cap;
    const pairs = up < down ? up : down;
    const choices: Array<{kind:ActionKind;side:Side;amount:string;label:string}> = [];
    if (held === 0n) return {market,held:held.toString(),pairs:pairs.toString(),choices,note:'No unescrowed shares remain on this side. Check /orders for locked shares.'};
    if (oc.isVoided || (oc.isResolved && oc.winningOutcome === (side === 'Up' ? 0 : 1))) {
      choices.push({kind:'redeem',side,amount:'0',label:'Review settlement claim'});
      return {market,held:held.toString(),pairs:pairs.toString(),choices,note:oc.isVoided?'Market voided. Claim this side at the contract payout.':'This side won. Claim collateral without needing order-book liquidity.'};
    }
    if (oc.isResolved) return {market,held:held.toString(),pairs:pairs.toString(),choices,note:'This side lost and has no settlement payout.'};
    if (oc.status !== 1 || oc.finalized || market.expiry <= Date.now()/1000 + settings.minSeconds)
      return {market,held:held.toString(),pairs:pairs.toString(),choices,note:'The trading window is closing or awaiting settlement. Refresh after resolution to check the payout.'};
    // Verify the pool generation before suggesting a merge or a sale.
    await this.live(market);
    if (pairs > 0n) choices.push({kind:'merge',side,amount:formatUnits(pairs < cap ? pairs : cap,market.decimals),label:'Review complete-set merge'});
    const fresh = await this.market(marketId);
    if ((side === 'Up' ? fresh.upBid : fresh.downBid) !== null)
      choices.push({kind:'sell',side,amount:formatUnits(quantity,market.decimals),label:'Review sale of held shares'});
    return {market:fresh,held:held.toString(),pairs:pairs.toString(),choices,
      note:'Merge uses equal Up + Down shares to recover collateral without a buyer. Selling depends on bids and can fill partially. Each action is capped at 100 shares; refresh afterwards for the remainder. These are available routes, not a best-price guarantee.'};
  }
  async market(id: string, withBook = true): Promise<MarketView> {
    if (!/^0x[0-9a-f]{64}$/i.test(id)) throw new PreflightError('Invalid market ID');
    const row = await this.exchange.client.getMarket(id);
    if (!row || !isBinaryMarket(row)) throw new PreflightError('Market is unavailable. Refresh /market.');
    if (row.collateral.toLowerCase() !== settings.collateral.toLowerCase() ||
      (settings.venueId && (row.venueId ?? '').toLowerCase() !== settings.venueId.toLowerCase()))
      throw new PreflightError('This market is outside the configured testnet venue.');
    const m: MarketView = { id: row.marketId, pool: row.poolAddress, asset: row.asset,
      question: row.question, expiry: Number(row.expiry), tradingStart: Number(row.tradingStart),
      decimals: row.quoteDecimals, venueId: row.venueId ?? '', upAsk: null, downAsk: null, upBid: null, downBid: null };
    if (withBook) {
      const oc = await this.exchange.client.getMarketOnchain(m.id);
      // Never mark a settled position to a recycled pool's next market.
      if (oc.status === 1 && !oc.finalized && m.expiry > Date.now()/1000) {
        const book = await this.exchange.client.getBinaryOrderBook(oc.pool, {depth: 20, decimals: m.decimals});
        m.upAsk = book.yesAsks[0]?.price.toString() ?? null;
        m.downAsk = book.noAsks[0]?.price.toString() ?? null;
        m.upBid = book.yesBids[0]?.price.toString() ?? null;
        m.downBid = book.noBids[0]?.price.toString() ?? null;
      }
    }
    return m;
  }
  async markets(offset = 0): Promise<{ markets: MarketView[]; next: number | null }> {
    const rows = await this.exchange.client.listLiveBinaryMarkets({limit: 8, offset,
      ...(settings.venueId ? {venueId: settings.venueId} : {})});
    const candidates = await Promise.all(rows.map(async row => {
      if (row.collateral.toLowerCase() !== settings.collateral.toLowerCase()) return null;
      const oc = await this.exchange.client.getMarketOnchain(row.marketId);
      if (oc.status !== 1 || oc.finalized || Number(row.expiry) <= Date.now()/1000 + settings.minSeconds) return null;
      return this.market(row.marketId);
    }));
    const markets = candidates.filter((m): m is MarketView => m !== null);
    return { markets, next: rows.length === 8 ? offset + 8 : null };
  }
  private async live(m: MarketView) {
    if (await this.public.getChainId() !== chain.id) throw new PreflightError('RPC is not Somnia testnet. Trading stopped.');
    const oc = await this.exchange.client.getMarketOnchain(m.id);
    if (oc.status !== 1 || oc.finalized || m.expiry <= Date.now()/1000 + settings.minSeconds)
      throw new PreflightError('This market is closing or has closed. Choose a newer market.');
    const pool = await this.public.readContract({address: oc.pool, abi: poolAbi, functionName: 'getBinaryPoolParams'});
    if (pool.market.toLowerCase() !== oc.marketAddress.toLowerCase() || pool.yesId !== BigInt(oc.yesId) || pool.finalized ||
      pool.collateralToken.toLowerCase() !== settings.collateral.toLowerCase() || pool.oneCollateral !== 10n ** BigInt(m.decimals))
      throw new PreflightError('The pool generation or collateral changed. Refresh the market.');
    return {oc, pool};
  }
  async quote(kind: ActionKind, m: MarketView, side: Side, amount: string, address: Address, limitPrice?: string, orderId?: string): Promise<Quote> {
    const q: Quote = {kind, market: m, side, amount, quantity: '0', price: '0', maxCost: '0', minReceive: '0',
      expiresAt: Date.now() + 60_000, ...(orderId ? {orderId} : {})};
    if (kind === 'cancel') {
      if (!orderId || !/^\d+$/.test(orderId)) throw new PreflightError('Choose an open order.');
      const order = await this.exchange.client.getOrderOnchain(m.pool, BigInt(orderId));
      if (!order || order.owner.toLowerCase() !== address.toLowerCase()) throw new PreflightError('This order is no longer open in your wallet.');
      return q;
    }
    if (kind === 'redeem') {
      const oc = await this.exchange.client.getMarketOnchain(m.id);
      if (!oc.isVoided && (!oc.isResolved || oc.winningOutcome !== (side === 'Up' ? 0 : 1)))
        throw new PreflightError('This side has no payout to claim yet.');
      q.quantity = (await this.exchange.client.getOutcomeBalance({outcomeToken: oc.outcomeToken, account: address, id: side === 'Up' ? oc.yesId : oc.noId})).toString();
      if (BigInt(q.quantity) === 0n) throw new PreflightError('Nothing to redeem on this side.');
      return q;
    }
    const {oc, pool} = await this.live(m);
    const grid = await this.exchange.client.getBinaryBookParams(oc.pool);
    const scale = 10n ** BigInt(m.decimals);
    const requested = units(amount, m.decimals);
    if (requested > units(settings.maxBudget, m.decimals)) throw new PreflightError('The testnet limit is 100 tUSDC or 100 shares per action.');
    if (kind === 'mint' || kind === 'merge') {
      q.quantity = requested.toString(); q.maxCost = kind === 'mint' ? requested.toString() : '0';
      q.minReceive = kind === 'merge' ? requested.toString() : '0'; return q;
    }
    const fresh = await this.market(m.id);
    const priceText = kind === 'sell' ? (side === 'Up' ? fresh.upBid : fresh.downBid) : (side === 'Up' ? fresh.upAsk : fresh.downAsk);
    if (kind !== 'limit' && priceText === null) throw new PreflightError('No liquidity on this side right now. Try another market.');
    let price = kind === 'limit' ? units(limitPrice ?? '', m.decimals) : BigInt(priceText!);
    // IOC protects at the displayed tick-aligned limit (up to 2 percentage points).
    const cushion = ((scale * 2n / 100n + grid.tickSize - 1n) / grid.tickSize) * grid.tickSize;
    if (kind === 'buy') price = price + cushion < scale ? price + cushion : scale - grid.tickSize;
    if (kind === 'sell') price = price > cushion ? price - cushion : grid.tickSize;
    price = (price / grid.tickSize) * grid.tickSize;
    if (price <= 0n || price >= scale) throw new PreflightError('Price must be inside 0 and 1 on the venue tick grid.');
    if (kind === 'sell') {
      q.quantity = (requested / grid.lotSize * grid.lotSize).toString();
      q.minReceive = ((BigInt(q.quantity) * price / scale) * (10_000_000n - pool.takerFeeBpsTimes1k) / 10_000_000n).toString();
    } else {
      const fee = pool.takerFeeBpsTimes1k > pool.makerFeeBpsTimes1k ? pool.takerFeeBpsTimes1k : pool.makerFeeBpsTimes1k;
      const size = sizeBudget(requested, price, scale, grid.lotSize, fee);
      q.quantity = size.quantity.toString(); q.maxCost = size.maxCost.toString();
    }
    if (BigInt(q.quantity) < grid.minQuantity) throw new PreflightError('That amount is below the market minimum.');
    // Store in YES terms for the raw trader; UI always displays the chosen outcome's price.
    q.price = (side === 'Up' ? price : scale - price).toString();
    return q;
  }
  async execute(userId: string, address: Address, q: Quote | TransferQuote, journal?: (s: NonNullable<Action['submissions']>[number]) => void): Promise<Execution> {
    if (q.kind === 'withdraw') return this.executeTransfer(userId, address, q, journal);
    // Everything before creating the signer is a known no-send failure.
    try {
      if (q.expiresAt <= Date.now()) throw new Error('Quote expired. Request a new one.');
      if (await this.public.getChainId() !== chain.id) throw new Error('Wrong chain');
      const balance = await this.balances(address);
      if (balance.stt < 10n ** 16n) throw new Error('Top up STT first (at least 0.01 STT for transaction and approval gas).');
      if (balance.collateral < BigInt(q.maxCost)) throw new Error('Not enough tUSDC. Top up with /wallet.');
      if (!['cancel','redeem'].includes(q.kind)) {
        const live = await this.live(q.market);
        if (q.market.decimals !== 6) throw new Error('This testnet signer requires 6-decimal tUSDC.');
        if (q.kind === 'buy' || q.kind === 'limit') {
          const scale = 10n ** BigInt(q.market.decimals);
          const price = q.side === 'Up' ? BigInt(q.price) : scale - BigInt(q.price);
          const fee = live.pool.takerFeeBpsTimes1k > live.pool.makerFeeBpsTimes1k ? live.pool.takerFeeBpsTimes1k : live.pool.makerFeeBpsTimes1k;
          const max = sizeBudget(BigInt(q.maxCost),price,scale,1n,fee);
          if (max.quantity < BigInt(q.quantity)) throw new Error('Fees changed; request a fresh quote.');
        }
      }
      const oc = await this.exchange.client.getMarketOnchain(q.market.id);
      if (['sell','merge','redeem'].includes(q.kind)) {
        const sides = q.kind === 'merge' ? ['Up','Down'] : [q.side];
        for (const side of sides) {
          const held = await this.exchange.client.getOutcomeBalance({outcomeToken: oc.outcomeToken, account: address, id: side === 'Up' ? oc.yesId : oc.noId});
          if (held < BigInt(q.quantity)) throw new Error('Your outcome balance changed. Request a fresh quote.');
        }
      }
      if (q.kind === 'redeem' && !oc.isVoided && (!oc.isResolved || oc.winningOutcome !== (q.side === 'Up' ? 0 : 1))) throw new Error('This side cannot be redeemed for a payout.');
      if (q.kind === 'cancel') {
        const order = await this.exchange.client.getOrderOnchain(q.market.pool, BigInt(q.orderId!));
        if (!order || order.owner.toLowerCase() !== address.toLowerCase()) throw new Error('Order already filled/cancelled or does not belong to you.');
      }
    } catch (e) { throw new PreflightError((e as Error).message); }
    const account = privateKeyToAccount(this.wallets.privateKey(userId));
    const actionTarget = q.kind === 'redeem' ? SOMNIA_TESTNET_ADDRESSES.binaryModule! : q.market.pool;
    const signTransaction: typeof account.signTransaction = async (tx, options) => {
      const signed = await account.signTransaction(tx, options);
      // Persist only hash/target BEFORE broadcast. Never store the signed bytes.
      journal?.({ hash: keccak256(signed), target: tx.to ?? '',
        purpose: tx.to?.toLowerCase() === actionTarget.toLowerCase() ? 'action' : 'approval' });
      return signed;
    };
    const ex = this.makeExchange({...account, signTransaction});
    try {
      const m = q.market;
      let res;
      if (['buy','sell','limit'].includes(q.kind)) {
        const oc = await ex.client.getMarketOnchain(m.id);
        res = await ex.trader.placeOrder({pool: oc.pool,
          side: `${q.kind === 'sell' ? 'SELL' : 'BUY'}_${q.side === 'Up' ? 'YES' : 'NO'}`,
          price: BigInt(q.price), quantity: BigInt(q.quantity), collateral: settings.collateral,
          outcomeToken: oc.outcomeToken, yesId: BigInt(oc.yesId), noId: BigInt(oc.noId),
          orderType: q.kind === 'limit' ? ORDER_TYPE.POST_ONLY : ORDER_TYPE.MARKET,
          expireTimestampNs: BigInt(Math.min(m.expiry, Math.floor(Date.now()/1000) + 300)) * 1_000_000_000n,
        });
      } else if (q.kind === 'mint') res = await ex.trader.mintSet({pool: m.pool, amount: BigInt(q.quantity), collateral: settings.collateral});
      else if (q.kind === 'merge') res = await ex.trader.burnSet({pool: m.pool, amount: BigInt(q.quantity)});
      else if (q.kind === 'cancel') res = await ex.trader.cancelOrder({pool: m.pool, orderId: q.orderId!});
      else {
        const oc = await ex.client.getMarketOnchain(m.id);
        res = await ex.trader.redeem({marketId: m.id, market: oc.marketAddress, outcomeToken: oc.outcomeToken,
          outcomeIdx: q.side === 'Up' ? 0 : 1, amount: BigInt(q.quantity)});
      }
      if (res.receipt.status !== 'success' || !/^0x[0-9a-f]{64}$/i.test(res.receipt.transactionHash)) throw new Error('Transaction receipt could not be verified');
      const order = res as PlaceOrderResult;
      const fill = Array.isArray(order.fills) ? receiptFills(order.fills, q.side, m.decimals) : {filled: '0', cash: '0'};
      return {hash: res.receipt.transactionHash, ...fill, orderId: order.orderId?.toString(),
        summary: Array.isArray(order.fills)
          ? `${fill.filled} ${q.side} shares filled · ${fill.cash} tUSDC ${q.kind === 'sell' ? 'gross proceeds' : 'fill cost'} (before fees).${q.kind === 'limit' ? ' Remaining order rests for up to 5 minutes.' : ' Unfilled remainder cancelled.'}`
          : `${q.kind} confirmed on Somnia testnet.`};
    } finally { ex.close(); }
  }
  async reconcile(address: Address, a: Action): Promise<{state:'confirmed'|'failed';result?:Execution} | null> {
    const sent = a.submissions?.slice().reverse().find(s=>s.purpose === 'action');
    if (!sent) return null;
    let receipt;
    try { receipt = await this.public.getTransactionReceipt({hash:sent.hash}); }
    catch { return null; }
    if (receipt.from.toLowerCase() !== address.toLowerCase() || receipt.to?.toLowerCase() !== sent.target.toLowerCase())
      throw new Error('Journal receipt identity mismatch');
    if (receipt.status === 'reverted') return {state:'failed'};
    if (a.quote.kind === 'withdraw') return {state:'confirmed', result:this.transferReceipt(address, a.quote, receipt)};
    const fills: OrderFill[] = []; let orderId: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== a.quote.market.pool.toLowerCase()) continue;
      try {
        const event = decodeEventLog({abi:orderBookEventsAbi,data:log.data,topics:log.topics});
        if (event.eventName === 'OrderFilled') fills.push(event.args);
        if (event.eventName === 'OrderPlaced') orderId = event.args.orderId.toString();
      } catch { /* Other contract event. */ }
    }
    const fill = receiptFills(fills,a.quote.side,a.quote.market.decimals);
    return {state:'confirmed',result:{hash:receipt.transactionHash,...fill,orderId,
      summary: ['buy','sell','limit'].includes(a.quote.kind)
        ? `${fill.filled} ${a.quote.side} shares filled · ${fill.cash} tUSDC before fees. Recovered from on-chain receipt.`
        : `${a.quote.kind} confirmed. Recovered from on-chain receipt.`}};
  }
  async position(address: Address, marketId: string, side: Side): Promise<PositionView> {
    const m = await this.market(marketId, false);
    const oc = await this.exchange.client.getMarketOnchain(m.id);
    const balance = await this.exchange.client.getOutcomeBalance({outcomeToken: oc.outcomeToken, account: address, id: side === 'Up' ? oc.yesId : oc.noId});
    let cost: string | null = null, value: string | null = null, pnl: string | null = null, realized: string | null = null, indexed = false;
    try {
      const data = await this.exchange.client.getBinaryPositionPnL(address, m.id);
      const leg = side === 'Up' ? data.outcomes.yes : data.outcomes.no;
      // An indexer behind the chain cannot yet substantiate the displayed P/L.
      if (leg.balance === balance) {
        indexed = true; cost = leg.costBasis.toString(); value = leg.markValue?.toString() ?? null;
        pnl = leg.unrealizedPnl?.toString() ?? null; realized = leg.realizedPnl.toString();
      }
    } catch { /* Keep on-chain shares visible; label unavailable accounting. */ }
    return {market: m, side, balance: balance.toString(), cost, value, pnl, realized, indexed,
      status: oc.isVoided ? 'Voided · both sides can claim' : oc.isResolved ? `${oc.winningOutcome === 0 ? 'Up' : 'Down'} won` : oc.status === 1 ? 'Open' : 'Awaiting settlement', asOf: Date.now()};
  }
  async makerStats(address: Address, actions: Action[]): Promise<{volume:number;trades:number;complete:boolean}> {
    const resting = actions.filter((a): a is Action & {quote:Quote} => a.state==='confirmed' && a.quote.kind==='limit' && !!a.result?.orderId);
    if (!resting.length) return {volume:0,trades:0,complete:true};
    const orders = new Map(resting.map(a=>[`${a.quote.market.id.toLowerCase()}:${a.result!.orderId}`,a]));
    const markets = [...new Set(resting.map(a=>a.quote.market.id))];
    const txs = new Set<string>(); let volume = 0;
    for (let offset=0; offset<1000; offset+=100) {
      const fills = await this.exchange.client.getUserFills(address,{markets,limit:100,offset});
      for (const f of fills) {
        const order = orders.get(`${f.market.toLowerCase()}:${f.makerOrderId}`);
        if (!order || f.maker?.toLowerCase() !== address.toLowerCase()) continue;
        const scale = 10n ** BigInt(order.quote.market.decimals);
        const ownPrice = order.quote.side === 'Up' ? BigInt(f.fillPrice) : scale - BigInt(f.fillPrice);
        volume += Number(formatUnits(BigInt(f.quantity) * ownPrice / scale,order.quote.market.decimals));
        txs.add(f.txHash);
      }
      if (fills.length<100) return {volume,trades:txs.size,complete:true};
    }
    return {volume,trades:txs.size,complete:false};
  }
  async openOrders(address: Address) {
    return this.exchange.client.getOrders(address, {status: 'Open', limit: 50});
  }
  async portfolio(address: Address) { return this.exchange.client.getOpenPositionsWithPnL(address); }
  async claimable(address: Address) { return this.exchange.client.getClaimable(address); }
}
