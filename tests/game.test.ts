import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankForXp, xpForResult, payoutFor, profitFor, closesIn, maxStakeFor } from "../src/game.js";

describe("payout math", () => {
  it("stake at 50% doubles", () => {
    assert.equal(payoutFor(25, 0.5), 50);
    assert.equal(profitFor(25, 0.5), 25);
  });
  it("favorite pays less than dog", () => {
    assert.ok(payoutFor(10, 0.8) < payoutFor(10, 0.2));
  });
  it("degenerate prices pay nothing", () => {
    assert.equal(payoutFor(10, 0), 0);
    assert.equal(payoutFor(10, 1), 0);
    assert.equal(payoutFor(10, NaN), 0);
  });
});

describe("ranks", () => {
  it("climbs Spark to Chronomancer", () => {
    assert.equal(rankForXp(0), "Spark");
    assert.equal(rankForXp(300), "Threadkeeper");
    assert.equal(rankForXp(800), "Riftwalker");
    assert.equal(rankForXp(1500), "Paradox");
    assert.equal(rankForXp(2600), "Chronomancer");
  });
});

describe("xp", () => {
  it("losses still earn a little", () => {
    assert.equal(xpForResult({ won: false, streakAfter: 0 }), 10);
  });
  it("streaks compound, capped", () => {
    const a = xpForResult({ won: true, streakAfter: 1 });
    const b = xpForResult({ won: true, streakAfter: 4 });
    const c = xpForResult({ won: true, streakAfter: 40 });
    assert.ok(b > a);
    assert.equal(c, 225);
  });
});

describe("helpers", () => {
  it("closesIn reads like a countdown", () => {
    assert.equal(closesIn(1000, 1000), "0s");
    assert.equal(closesIn(1090, 1000), "1m 30s");
  });
  it("max stake respects vault and cap", () => {
    assert.equal(maxStakeFor(1000, 100), 100);
    assert.equal(maxStakeFor(7, 100), 7);
  });
});
