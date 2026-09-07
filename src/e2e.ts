/**
 * Chronomancer e2e against Somnia Shannon testnet (chain 50312).
 *
 * Read-only by default: RPC head, MarketCreated scan, live windows with
 * book odds, settlement read. No key, no spending, judge-safe.
 *
 * With a funded PRIVATE_KEY and --unified, also exercises the indexed
 * unified tier (loadMarkets + symbols + order-book touch).
 *
 * Run: npm run e2e [-- --unified]
 */
import { isBinaryMarket } from "@somnia-chain/markets-sdk";
import { cfg, isHouseAddress } from "./config.js";
import { pub, readExchange, discoverWindows, settleInfo, closeExchanges } from "./dream.js";

const args = new Set(process.argv.slice(2));
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

try {
  const client = pub();
  const head = await client.getBlockNumber();
  check("rpc head", head > 0n, `block ${head}`);

  const start = Date.now();
  const wins = await discoverWindows(6);
  const ms = Date.now() - start;
  check("discoverWindows", true, `${wins.length} open window(s) in ${ms}ms`);
  for (const w of wins.slice(0, 6)) {
    const left = Math.max(0, Math.round((w.expiry - Date.now() / 1000) / 60));
    console.log(
      `      ${w.asset.padEnd(4)} ${String(w.minutes).padStart(3)}m  seals in ~${left}m  ` +
        `Rise ${w.upPct === null ? "forming" : `${w.upPct}%`}  marketId=${w.marketId.slice(0, 10)}…`
    );
  }

  if (wins[0]) {
    const info = await settleInfo(wins[0].marketId);
    check("settleInfo", info.status === 1 && !info.finalized, `status=${info.status} (1=Trading)`);
    check(
      "house id configured",
      cfg.houseAddress.length >= 42,
      isHouseAddress(cfg.houseAddress) ? `${cfg.houseAddress} (trophy owner)` : `${cfg.houseAddress} (house id)`
    );
  } else {
    console.log("      (no open windows right now — rerun in a minute; windows respawn on schedule)");
  }

  if (args.has("--unified")) {
    if (!cfg.hasLiveKey) {
      console.log("SKIP  unified tier — no PRIVATE_KEY (read-only mode)");
    } else {
      const ex = readExchange();
      const markets = Object.values(await ex.loadMarkets(true));
      const binaries = markets.filter((m) => m.active && isBinaryMarket(m.info));
      check("loadMarkets unified", markets.length > 0, `${binaries.length} active binary / ${markets.length} total`);
      const first = binaries[0];
      const symbols = first?.outcomes?.map((o) => o?.symbol).filter(Boolean) ?? [];
      check("outcome symbols", symbols.length >= 2, symbols.slice(0, 2).join(" | "));
      if (symbols[0]) {
        const book = await ex.fetchOrderBook(symbols[0] as string, 3);
        check("fetchOrderBook touch", true, `bids=${book.bids.length} asks=${book.asks.length}`);
      }
    }
  }
} catch (e) {
  failures += 1;
  console.error(`FAIL  e2e threw — ${(e as Error).message}`);
} finally {
  closeExchanges();
}

console.log(failures === 0 ? "\nThe rift acknowledges you. All green." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
