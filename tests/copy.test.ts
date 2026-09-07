import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  welcome,
  howItWorks,
  windowList,
  windowDetail,
  confirmProphecy,
  sealed,
  winSealed,
  lossSealed,
  vault,
  leaders,
} from "../src/copy.js";

/** Pictographs and dingbats are banned; the wizard speaks in words. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const samples = [
  welcome(true, 1000),
  welcome(false, 120),
  howItWorks(),
  windowList([
    { id: "0", asset: "BTC", minutes: 5, closesIn: "03:12", upPct: 62 },
    { id: "1", asset: "ETH", minutes: 15, closesIn: "11:02", upPct: null },
  ]),
  windowList([]),
  windowDetail({ asset: "BTC", minutes: 5, closesIn: "03:12", upPct: 62, whisper: "Mood: restless." }),
  confirmProphecy({ asset: "BTC", side: "Rise", stake: 25, price: 0.62, toWin: 40 }),
  sealed({ side: "Rise", asset: "BTC", stake: 25, mode: "paper" }),
  sealed({ side: "Fall", asset: "ETH", stake: 10, mode: "live", tx: "0x1234567890abcdef1234567890abcdef12345678" }),
  winSealed({ payout: 40, stake: 25, streak: 3, rank: "Riftwalker" }),
  lossSealed({ stake: 25, streakWas: 0 }),
  lossSealed({ stake: 25, streakWas: 4 }),
  vault({ sand: 1140, rank: "Threadkeeper", xp: 320, streak: 2, best: 4, open: 1, settled: 9, wins: 5 }),
  leaders([
    { name: "Mira", rank: "Paradox", sand: 2400, streak: 6 },
    { name: "Ash", rank: "Spark", sand: 900, streak: 0 },
  ]),
  leaders([]),
];

describe("voice", () => {
  it("never leans on emojis", () => {
    for (const s of samples) assert.ok(!EMOJI.test(s), `emoji found in: ${s.slice(0, 80)}`);
  });
  it("stays plain-text readable (HTML tags only)", () => {
    for (const s of samples) {
      const stripped = s.replace(/<\/?(b|i|code)>/g, "");
      assert.ok(!/<[a-z]/.test(stripped), `unexpected markup in: ${stripped.slice(0, 80)}`);
    }
  });
  it("welcome endows the starting sand", () => {
    assert.ok(welcome(true, 1000).includes("1000"));
  });
  it("losses are kind and memorable", () => {
    assert.ok(lossSealed({ stake: 25, streakWas: 4 }).includes("timefold"));
  });
});
