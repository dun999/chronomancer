import { RANK_NAMES } from "./copy.js";

/** XP thresholds for each rank index. */
const RANK_XP = [0, 300, 800, 1500, 2500];

export function rankForXp(xp: number): (typeof RANK_NAMES)[number] {
  let r: (typeof RANK_NAMES)[number] = RANK_NAMES[0];
  for (let i = 0; i < RANK_NAMES.length; i++) {
    if (xp >= RANK_XP[i]) r = RANK_NAMES[i];
  }
  return r;
}

export function xpForResult(o: { won: boolean; streakAfter: number }): number {
  if (!o.won) return 10; // showing up counts
  return 100 + Math.min(125, 25 * Math.max(0, o.streakAfter - 1));
}

/**
 * Binary payout math. Stake s at probability price p buys s/p contracts
 * paying 1 each. Returns whole grains, floored.
 */
export function payoutFor(stake: number, price: number): number {
  if (!(price > 0) || !(price < 1)) return 0;
  return Math.floor(stake / price);
}

export function profitFor(stake: number, price: number): number {
  return payoutFor(stake, price) - stake;
}

export const STAKES = [10, 25, 50] as const;

export function maxStakeFor(balance: number, cap: number): number {
  return Math.max(1, Math.min(balance, cap));
}

export function closesIn(expirySec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, expirySec - nowSec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
