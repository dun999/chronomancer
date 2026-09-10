export type Side = 'Up' | 'Down';
export type ActionKind = 'buy' | 'sell' | 'limit' | 'cancel' | 'mint' | 'merge' | 'redeem';
export interface MarketView {
  id: `0x${string}`; pool: `0x${string}`; asset: string; question: string;
  expiry: number; tradingStart: number; decimals: number; venueId: string;
  upAsk: string | null; downAsk: string | null; upBid: string | null; downBid: string | null;
}
export interface Quote {
  kind: ActionKind; market: MarketView; side: Side; amount: string;
  quantity: string; price: string; maxCost: string; minReceive: string;
  orderId?: string; expiresAt: number;
}
export interface TransferQuote {
  kind: 'withdraw'; asset: 'tUSDC'; recipient: `0x${string}`;
  token: `0x${string}`; chainId: 50312; amount: string; quantity: string;
  decimals: 6; expiresAt: number;
}
export interface Execution {
  hash: string; filled: string; cash: string; orderId?: string;
  summary: string;
}
export interface WalletUser {
  id: string; name: string; address: `0x${string}`; wallet: string;
  stage: number; streak: number; lastDay: string; xp: number; createdAt: number;
}
export interface Action {
  id: string; userId: string; quote: Quote | TransferQuote; state: 'pending' | 'executing' | 'confirmed' | 'failed' | 'unknown' | 'cancelled';
  createdAt: number; result?: Execution; error?: string;
  submissions?: Array<{hash: `0x${string}`; target: string; purpose: 'action' | 'approval'}>;
}
export interface PositionView {
  market: MarketView; side: Side; balance: string; cost: string | null;
  value: string | null; pnl: string | null; realized: string | null;
  status: string; asOf: number; indexed: boolean;
}
export interface News { title: string; url: string; date: string; }
export interface Decision {
  intent: 'opportunities' | 'buy' | 'positions' | 'activity' | 'markets' | 'close' | 'withdraw' | 'wallet' | 'redeem' | 'orders' | 'explain';
  reply: string; marketId: string | null; side: Side | null; amount: string | null;
  picks: Array<{marketId: string; side: Side; conviction: 'low' | 'medium'; reason: string; evidence: string[]}>;
}
