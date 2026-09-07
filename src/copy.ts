/**
 * Every word the player reads. One voice: a tired time-wizard who has seen
 * every timeline and still finds yours interesting.
 *
 * Rules: no emojis, plain words, short lines. Funny, never loud.
 * Telegram HTML parse_mode is used (<b>, <i>, <code>).
 */

export const RANK_NAMES = ["Spark", "Threadkeeper", "Riftwalker", "Paradox", "Chronomancer"] as const;

export function welcome(isNew: boolean, sand: number): string {
  if (isNew) {
    return (
      `<b>Chronomancer</b>\n` +
      `<i>You knocked. The rift answered. Rude of it, honestly — it never sleeps.</i>\n\n` +
      `Here is the arrangement: I show you a live market window on DreamDEX — ` +
      `say, where BTC stands a few minutes from now. You declare what happens: <b>Rise</b> or <b>Fall</b>.\n\n` +
      `Call it right and the timeline pays you. Call it wrong and the rift keeps your sand, ` +
      `which is what the rift does with everything.\n\n` +
      `You begin with <b>${sand} grains of time-sand</b>. It is practice sand. ` +
      `Softer than real sand. Barely haunted.\n\n` +
      `Tap below when ready. No hurry — well, some hurry. The windows close.`
    );
  }
  return (
    `<b>Welcome back, traveler.</b>\n` +
    `Your vault holds <b>${sand} sand</b>. The timelines kept moving without you. ` +
    `Ungrateful things, timelines.`
  );
}

export function howItWorks(): string {
  return (
    `<b>How a prophecy works</b>\n\n` +
    `1. Pick a window — BTC over the next few minutes, for example.\n` +
    `2. Read the odds. <code>62</code> means the crowd thinks Rise has a 62% chance.\n` +
    `3. Stake some sand on <b>Rise</b> or <b>Fall</b>.\n` +
    `4. Wait for the window to seal. Winners are paid <b>1 per contract</b>; losers keep the lesson.\n\n` +
    `The most you can lose is your stake. There are no liquidations here, ` +
    `no margin calls at midnight, no greek letters.\n\n` +
    `Win several in a row and you build a <b>timefold</b> — consecutive wins ` +
    `that make the older wizards nervous. Earn sand, earn titles, from Spark all the way to Chronomancer.`
  );
}

export interface WindowLine {
  id: string;
  asset: string;
  minutes: number;
  closesIn: string;
  upPct: number | null;
}

export function windowList(lines: WindowLine[]): string {
  if (lines.length === 0) {
    return (
      `The rift is quiet right now — no open windows with room to maneuver.\n\n` +
      `This happens between windows. Give it a minute and peer again. ` +
      `The timelines respawn on schedule; they cannot help themselves.`
    );
  }
  const rows = lines
    .map((w) => {
      const odds = w.upPct === null ? `odds forming` : `Rise ${w.upPct}% · Fall ${100 - w.upPct}%`;
      return `<b>${w.asset}</b> · ${w.minutes} min · seals in ${w.closesIn}\n${odds}`;
    })
    .join("\n\n");
  return `<b>Open windows</b>\n<i>Pick one to inspect. Faint of heart: take the one with the longest fuse.</i>\n\n${rows}`;
}

export function windowDetail(o: {
  asset: string;
  minutes: number;
  closesIn: string;
  upPct: number | null;
  whisper: string | null;
}): string {
  const odds =
    o.upPct === null
      ? `The book is still waking up — no resting orders yet.`
      : `Rise <b>${o.upPct}</b> · Fall <b>${100 - o.upPct}</b>`;
  const whisper = o.whisper ? `\n\n<i>Oracle whisper: ${escapeHtml(o.whisper)}</i>` : "";
  return (
    `<b>${o.asset}</b> · ${o.minutes}-minute window · seals in ${o.closesIn}\n` +
    `${odds}${whisper}\n\n` +
    `Declare the ending. Then stake your sand like you mean it.`
  );
}

export function confirmProphecy(o: {
  asset: string;
  side: "Rise" | "Fall";
  stake: number;
  price: number | null;
  toWin: number | null;
}): string {
  const line =
    o.price !== null && o.toWin !== null
      ? `At current odds this pays <b>${o.toWin} sand</b> if the timeline obeys.`
      : `Odds are still forming — payout will be set from the live book.`;
  return (
    `You are about to declare <b>${o.side}</b> on <b>${o.asset}</b> for <b>${o.stake} sand</b>.\n` +
    `${line}\n\n` +
    `Worst case: you lose the stake and gain a story. Confirm?`
  );
}

export function sealed(o: { side: string; asset: string; stake: number; mode: "paper" | "live"; tx?: string }): string {
  const where =
    o.mode === "live" && o.tx
      ? `\nSealed onchain: <code>${o.tx.slice(0, 10)}…${o.tx.slice(-6)}</code>`
      : `\nSealed in practice sand. The real rift remains unbothered.`;
  return (
    `It is written. <b>${o.side}</b> on <b>${o.asset}</b>, <b>${o.stake} sand</b>.${where}\n\n` +
    `Now we wait for the window to seal. Patience, mage. Go hydrate.`
  );
}

export function winSealed(o: { payout: number; stake: number; streak: number; rank: string }): string {
  const fold =
    o.streak >= 2
      ? `\nTimefold <b>x${o.streak}</b> — reality is starting to notice.`
      : ``;
  return (
    `The timeline bends your way. <b>+${o.payout} sand</b> on a ${o.stake} stake.` +
    `${fold}\nRank: <b>${o.rank}</b>. Spend the glow wisely; it fades by morning.`
  );
}

export function lossSealed(o: { stake: number; streakWas: number }): string {
  const comfort =
    o.streakWas >= 2
      ? `Your timefold of ${o.streakWas} ends here. A moment of silence. It was a good fold.`
      : `That timeline slipped away. The rift keeps the ${o.stake} sand as a souvenir.`;
  return `${comfort}\nThe next window is already forming. The rift forgives; it just charges sand.`;
}

export function voided(o: { refund: number }): string {
  return (
    `The oracle shrugged — no reliable settlement for that window, so both sides were refunded half. ` +
    `You get <b>${o.refund} sand</b> back. Even the rift admits when it does not know. Rare. Cherish it.`
  );
}

export function vault(o: {
  sand: number;
  rank: string;
  xp: number;
  streak: number;
  best: number;
  open: number;
  settled: number;
  wins: number;
}): string {
  return (
    `<b>Your vault</b>\n` +
    `Sand: <b>${o.sand}</b> · Rank: <b>${o.rank}</b> (${o.xp} xp)\n` +
    `Timefold: <b>x${o.streak}</b> · Best fold: <b>x${o.best}</b>\n` +
    `Scrolls: ${o.open} open · ${o.settled} sealed · ${o.wins} timelines bent your way`
  );
}

export function leaders(rows: { name: string; rank: string; sand: number; streak: number }[]): string {
  if (rows.length === 0) return `No mages on the board yet. Be the first legend. The bar is low and the glory is real.`;
  const lines = rows
    .map((r, i) => `${i + 1}. <b>${escapeHtml(r.name)}</b> — ${r.sand} sand · ${r.rank} · fold x${r.streak}`)
    .join("\n");
  return `<b>Hall of Mages</b>\n<i>Ranked by sand. Wisdom optional.</i>\n\n${lines}`;
}

export function whisperText(t: string): string {
  return `<i>Oracle whisper: ${escapeHtml(t)}</i>`;
}

export function modeLine(mode: "paper" | "live"): string {
  return mode === "paper"
    ? `You are practicing on <b>time-sand</b>. Soft, safe, slightly haunted. Use /real to touch the actual testnet rift.`
    : `You are touching the <b>live testnet rift</b>. Real transactions, play-money tokens. The timelines can smell confidence.`;
}

export function noKeyForLive(): string {
  return (
    `The live rift needs a funded key on this server, and there is none configured. ` +
    `So you remain in the practice sands — honestly, a fine place. Tell the keeper to set PRIVATE_KEY.`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
