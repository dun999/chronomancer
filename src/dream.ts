import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cfg, MIN_SECONDS_LEFT } from "./config.js";

/**
 * Creation events, inlined from the SDK's events ABI so we never depend on a
 * deep dist import (blocked by package exports in 0.29+). Both variants are
 * scanned: older windows came through the MarketCreator wrapper (13 fields,
 * with intervalSec); current testnet windows are created via the
 * BinaryMarketsModule directly (19 fields, no intervalSec — minutes are
 * derived from expiry - tradingStart).
 */
const MARKET_CREATED_VIA_CREATOR = parseAbiItem(
  "event MarketCreated(bytes32 indexed marketId, address indexed market, address indexed pool, uint256 yesId, uint256 noId, address collateral, string asset, uint256 strike, uint64 tradingStart, uint64 expiry, uint256 oracleQuestionId, string question, uint64 intervalSec)"
);

const MARKET_CREATED_VIA_MODULE = parseAbiItem(
  "event MarketCreated(bytes32 indexed marketId, address indexed market, address indexed pool, uint256 oracleQuestionId, uint32 operatorId, bytes32 venueId, address creator, address collateral, uint256 yesId, uint256 noId, uint64 nonce, uint8 outcomeSlotCount, uint8 marketType, uint64 tradingStart, uint64 expiry, uint8 voidPolicy, string asset, uint256 strike, string question, bytes context)"
);

const SOMNIA_TESTNET = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
} as const;

export interface Window {
  marketId: Hex;
  pool: Address;
  asset: string;
  minutes: number;
  expiry: number;
  upPct: number | null;
  yesAskRaw: bigint | null;
}

let readEx: SomniaMarkets | null = null;
let writeEx: SomniaMarkets | null = null;

export function pub() {
  return createPublicClient({ chain: SOMNIA_TESTNET, transport: http(cfg.rpcUrl) });
}

export function readExchange(): SomniaMarkets {
  if (!readEx) {
    readEx = new SomniaMarkets({
      chain: SOMNIA_TESTNET,
      addresses: SOMNIA_TESTNET_ADDRESSES,
      wsRpcUrl: cfg.wsRpcUrl,
      indexerUrl: cfg.indexerUrl,
    });
  }
  return readEx;
}

function writeExchange(): SomniaMarkets {
  if (!cfg.hasLiveKey || !cfg.privateKey) throw new Error("no live key configured");
  if (!writeEx) {
    writeEx = new SomniaMarkets({
      chain: SOMNIA_TESTNET,
      addresses: SOMNIA_TESTNET_ADDRESSES,
      privateKey: cfg.privateKey,
      wsRpcUrl: cfg.wsRpcUrl,
      indexerUrl: cfg.indexerUrl,
    });
  }
  return writeEx;
}

export function closeExchanges(): void {
  try {
    readEx?.close?.();
  } catch {
    /* noop */
  }
  try {
    writeEx?.close?.();
  } catch {
    /* noop */
  }
  readEx = null;
  writeEx = null;
}

interface RawCandidate {
  marketId: Hex;
  pool: Address;
  asset: string;
  expiry: number;
  minutes: number;
}

async function scanCandidates(limit = 6): Promise<RawCandidate[]> {
  const client = pub();
  const head = await client.getBlockNumber();
  const collateral = String(SOMNIA_TESTNET_ADDRESSES.testUsdc ?? "").toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const found: RawCandidate[] = [];
  const seen = new Set<string>();
  // Module first: current testnet windows are created there. The creator
  // wrapper is a legacy fallback and gets a shorter walk.
  const moduleAddr = SOMNIA_TESTNET_ADDRESSES.binaryModule;
  const creatorAddr = SOMNIA_TESTNET_ADDRESSES.marketCreator;
  const walks: Array<{ addr: Address; rounds: number }> = [];
  if (moduleAddr) walks.push({ addr: moduleAddr as Address, rounds: 40 });
  if (creatorAddr) walks.push({ addr: creatorAddr as Address, rounds: 10 });
  const abiFor = (addr: string) =>
    addr.toLowerCase() === String(SOMNIA_TESTNET_ADDRESSES.binaryModule).toLowerCase()
      ? MARKET_CREATED_VIA_MODULE
      : MARKET_CREATED_VIA_CREATOR;
  // Somnia caps getLogs at 1000 blocks per call; walk back while hungry.
  // Newest windows are found in the first few slices, so stop early.
  for (const { addr, rounds } of walks) {
    for (let i = 0; i < rounds && found.length < limit * 3; i++) {
      const to = head - BigInt(i * 1000);
      const from = to - 999n;
      let logs: unknown[];
      try {
        logs = await client.getLogs({
          address: addr,
          event: abiFor(addr),
          fromBlock: from < 0n ? 0n : from,
          toBlock: to,
        });
      } catch {
        continue;
      }
      for (const log of logs as Array<{ args: Record<string, unknown> }>) {
        const a = log.args;
        const expiry = Number(a.expiry);
        if (!(expiry > now + MIN_SECONDS_LEFT)) continue;
        if (String(a.collateral).toLowerCase() !== collateral) continue;
        const marketId = String(a.marketId);
        if (seen.has(marketId)) continue;
        seen.add(marketId);
        const spanMin = Math.round((expiry - Number(a.tradingStart ?? expiry)) / 60);
        const intervalMin = a.intervalSec !== undefined ? Math.round(Number(a.intervalSec) / 60) : 0;
        found.push({
          marketId: marketId as Hex,
          pool: a.pool as Address,
          asset: String(a.asset || "BTC"),
          expiry,
          minutes: intervalMin || spanMin || 0,
        });
      }
    }
  }
  return found.sort((x, y) => x.expiry - y.expiry);
}

/** Best YES ask -> Rise probability, from the resting on-chain book. */
async function bookUpPct(pool: Address): Promise<{ upPct: number | null; yesAskRaw: bigint | null }> {
  try {
    const book = await readExchange().client.getBinaryOrderBook(pool, { depth: 5 });
    const ask = book.yesAsks?.[0]?.price;
    if (ask === undefined || ask === null) return { upPct: null, yesAskRaw: null };
    const pct = Math.round((Number(ask) / 1e6) * 100);
    return { upPct: Math.max(1, Math.min(99, pct)), yesAskRaw: ask as bigint };
  } catch {
    return { upPct: null, yesAskRaw: null };
  }
}

/**
 * Live windows, indexer-independent: discovery + status from chain,
 * odds from the resting book. Only status==1 (Trading) markets are returned.
 */
export async function discoverWindows(limit = 6): Promise<Window[]> {
  const ex = readExchange();
  const out: Window[] = [];
  let candidates: RawCandidate[] = [];
  try {
    candidates = await scanCandidates(limit);
  } catch {
    candidates = [];
  }
  for (const c of candidates.slice(0, limit * 3)) {
    if (out.length >= limit) break;
    let oc: { status: number; finalized: boolean };
    try {
      oc = await ex.client.getMarketOnchain(c.marketId);
    } catch {
      continue;
    }
    if (oc.finalized || oc.status !== 1) continue;
    const { upPct, yesAskRaw } = await bookUpPct(c.pool);
    out.push({ ...c, upPct, yesAskRaw });
  }
  return out;
}

export interface SettleInfo {
  status: number;
  finalized: boolean;
  isResolved: boolean;
  isVoided: boolean;
  /** 0 = Rise wins, 1 = Fall wins. Meaningful only when isResolved. */
  winningOutcome: number;
  marketAddress: Address;
  outcomeToken: Address;
}

export async function settleInfo(marketId: Hex): Promise<SettleInfo> {
  const oc = await readExchange().client.getMarketOnchain(marketId);
  return {
    status: oc.status,
    finalized: oc.finalized,
    isResolved: oc.isResolved,
    isVoided: oc.isVoided,
    winningOutcome: oc.winningOutcome,
    marketAddress: oc.marketAddress,
    outcomeToken: oc.outcomeToken,
  };
}

export interface LiveFill {
  tx: string;
  filled: number;
}

/**
 * Live taker fill via the unified tier (handles YES/NO price encoding).
 * Size is contracts; cost stays under stake at these odds. IOC so the
 * remainder never rests silently. Throws decoded reverts on failure.
 */
export async function placeLive(o: {
  marketId: Hex;
  side: "Rise" | "Fall";
  contracts: number;
}): Promise<LiveFill> {
  const ex = writeExchange();
  const markets = Object.values(await ex.loadMarkets(true));
  const m = markets.find((x) => isBinaryMarket(x.info) && (x.info as { marketId?: string }).marketId === o.marketId);
  if (!m) throw new Error("window left the live list — pick the next one");
  const outcomes = m.outcomes ?? [];
  const symbol = o.side === "Rise" ? outcomes[0]?.symbol : outcomes[1]?.symbol;
  if (!symbol) throw new Error("no tradable symbol for that side right now");
  const book = await ex.fetchOrderBook(symbol, 5);
  const touch = book.asks[0]?.[0];
  if (touch === undefined) throw new Error("the book is empty on that side — the makers have not arrived yet");
  const order = await ex.createOrder(symbol, "limit", "buy", o.contracts, touch + 0.02, { timeInForce: "IOC" });
  const info = order.info as { receipt?: { transactionHash?: string }; filled?: number };
  return { tx: info.receipt?.transactionHash ?? "0x", filled: info.filled ?? o.contracts };
}

/** Redeem winnings after settlement. Returns the claim tx, or null if nothing held. */
export async function redeemLive(o: { marketId: Hex; side: "Rise" | "Fall" }): Promise<string | null> {
  const ex = writeExchange();
  if (!cfg.privateKey) return null;
  const meAddr = privateKeyToAccount(cfg.privateKey).address;
  const oc = await ex.client.getMarketOnchain(o.marketId);
  if (!oc.isResolved && !oc.isVoided) return null;
  const outcomeIdx = oc.isVoided ? null : oc.winningOutcome === 0 ? 0 : 1;
  const sides: Array<0 | 1> = oc.isVoided ? [0, 1] : [outcomeIdx as 0 | 1];
  // Only claim the side the player holds.
  const wanted: Array<0 | 1> = sides.filter((s) => (o.side === "Rise" ? s === 0 : s === 1));
  for (const s of wanted) {
    const id = s === 0 ? BigInt(oc.yesId) : BigInt(oc.noId);
    const bal = await ex.client.getOutcomeBalance({ outcomeToken: oc.outcomeToken, account: meAddr, id });
    if (bal === 0n) continue;
    const res = await ex.trader.redeem({
      marketId: o.marketId,
      amount: bal,
      outcomeIdx: s,
      market: oc.marketAddress,
      outcomeToken: oc.outcomeToken,
    });
    const receipt = (res as { receipt?: { status?: string }; hash?: string }).receipt;
    if (receipt?.status === "reverted") throw new Error("redeem reverted onchain");
    return (res as { hash?: string }).hash ?? "claimed";
  }
  return null;
}
