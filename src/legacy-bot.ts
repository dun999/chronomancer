import { Telegraf, Markup } from "telegraf";
import { cfg, PAPER_MAX_STAKE } from "./config.js";
import { Store, type Prophecy } from "./store.js";
import { discoverWindows, placeLive, redeemLive, settleInfo, closeExchanges, type Window } from "./dream.js";
import { whisper } from "./oracle.js";
import {
  welcome,
  howItWorks,
  windowList,
  windowDetail,
  confirmProphecy,
  sealed,
  winSealed,
  lossSealed,
  voided,
  vault,
  leaders,
  whisperText,
  modeLine,
  noKeyForLive,
} from "./copy.js";
import { rankForXp, xpForResult, payoutFor, closesIn, maxStakeFor } from "./game.js";

const store = new Store();

let cached: { at: number; windows: Window[] } = { at: 0, windows: [] };
async function windows(): Promise<Window[]> {
  if (Date.now() - cached.at < 45_000 && cached.windows.length > 0) return cached.windows;
  const w = await discoverWindows(6);
  cached = { at: Date.now(), windows: w };
  return w;
}

interface Pending {
  marketId: string;
  pool: string;
  asset: string;
  minutes: number;
  expiry: number;
  side: "Rise" | "Fall";
  stake: number;
  price: number | null;
}
const pending = new Map<string, Pending>();

function uid(ctx: unknown): string {
  const c = ctx as { from?: { id?: number } };
  return String(c.from?.id ?? "0");
}

function uname(ctx: unknown): string {
  const c = ctx as { from?: { first_name?: string; username?: string } };
  const f = c.from;
  return (f?.first_name || (f?.username ? `@${f.username}` : "") || "nameless mage").slice(0, 64);
}

function windowLines(ws: Window[]) {
  const now = Math.floor(Date.now() / 1000);
  return ws.map((w, i) => ({
    id: String(i),
    asset: w.asset,
    minutes: w.minutes,
    closesIn: closesIn(w.expiry, now),
    upPct: w.upPct,
  }));
}

async function settlePass(bot: Telegraf): Promise<string[]> {
  const notes: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const p of store.openAll()) {
    if (p.expiry > now + 5) continue;
    let info;
    try {
      info = await settleInfo(p.marketId as `0x${string}`);
    } catch {
      continue;
    }
    if (!info.isResolved && !info.isVoided) continue;
    if (info.isVoided) {
      const refund = p.payout !== null ? Math.floor(p.payout / 2) : Math.floor(p.stake / 2);
      store.adjustSand(p.userId, refund);
      store.recordVoid(p.userId);
      store.addXp(p.userId, 10);
      store.setProphecyStatus(p.id, "voided");
      try {
        if (p.mode === "live") await redeemLive({ marketId: p.marketId as `0x${string}`, side: p.side });
      } catch {
        /* best effort */
      }
      notes.push(`${p.id}: void refund ${refund}`);
      try {
        await bot.telegram.sendMessage(p.userId, voided({ refund }), { parse_mode: "HTML" });
      } catch {
        /* user blocked the bot */
      }
      continue;
    }
    const winner = info.winningOutcome === 0 ? "Rise" : "Fall";
    if (p.side === winner) {
      const payout = p.payout ?? p.stake * 2;
      store.adjustSand(p.userId, payout);
      const u = store.recordWin(p.userId);
      const xp = xpForResult({ won: true, streakAfter: u.streak });
      store.addXp(p.userId, xp);
      store.setProphecyStatus(p.id, "won");
      try {
        if (p.mode === "live") await redeemLive({ marketId: p.marketId as `0x${string}`, side: p.side });
      } catch {
        /* best effort */
      }
      notes.push(`${p.id}: won ${payout}`);
      try {
        await bot.telegram.sendMessage(
          p.userId,
          winSealed({ payout, stake: p.stake, streak: u.streak, rank: rankForXp(u.xp) }),
          { parse_mode: "HTML" }
        );
      } catch {
        /* ignored */
      }
    } else {
      const { u, streakWas } = store.recordLoss(p.userId);
      store.addXp(p.userId, xpForResult({ won: false, streakAfter: 0 }));
      store.setProphecyStatus(p.id, "lost");
      notes.push(`${p.id}: lost ${p.stake}`);
      try {
        await bot.telegram.sendMessage(p.userId, lossSealed({ stake: p.stake, streakWas }), { parse_mode: "HTML" });
      } catch {
        /* ignored */
      }
      void u;
    }
  }
  return notes;
}

export function buildBot(): Telegraf {
  if (!cfg.botToken) throw new Error("TELEGRAM_BOT_TOKEN is not set — see .env.example");
  const bot = new Telegraf(cfg.botToken);

  bot.start(async (ctx) => {
    const { u, isNew } = store.user(uid(ctx), uname(ctx));
    await ctx.reply(welcome(isNew, u.sand), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Peer into the rift", "windows")],
        [Markup.button.callback("How does a prophecy work", "how")],
      ]),
    });
  });

  bot.command("how", async (ctx) => {
    await ctx.reply(howItWorks(), { parse_mode: "HTML" });
  });
  bot.action("how", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(howItWorks(), { parse_mode: "HTML" });
  });

  async function showWindows(ctx: { reply: Function }, edit?: { editMessageText: Function }) {
    let ws: Window[];
    try {
      ws = await windows();
    } catch {
      ws = [];
    }
    const text = windowList(windowLines(ws));
    const buttons =
      ws.length === 0
        ? [[Markup.button.callback("Peer again", "windows")]]
        : [
            ...ws.map((w, i) =>
              [Markup.button.callback(`${w.asset} · ${w.minutes}m · seals soon`, `w:${i}`)]
            ),
            [Markup.button.callback("Refresh the rift", "windows")],
          ];
    const extra = { parse_mode: "HTML" as const, ...Markup.inlineKeyboard(buttons) };
    if (edit) await edit.editMessageText(text, extra);
    else await (ctx.reply as (t: string, e: unknown) => Promise<unknown>)(text, extra);
  }

  bot.command("play", async (ctx) => showWindows(ctx));
  bot.action("windows", async (ctx) => {
    await ctx.answerCbQuery("Consulting the timelines…");
    await showWindows(ctx, ctx as unknown as { editMessageText: Function });
  });

  bot.action(/^w:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const ws = await windows();
    const w = ws[Number(ctx.match[1])];
    if (!w) {
      await ctx.reply("That window has already sealed. The rift moves on; so should you.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const wLine = windowDetail({
      asset: w.asset,
      minutes: w.minutes,
      closesIn: closesIn(w.expiry, now),
      upPct: w.upPct,
      whisper: await whisper(w.asset),
    });
    await ctx.editMessageText(wLine, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Rise — it climbs", `s:${ctx.match[1]}:R`), Markup.button.callback("Fall — it slips", `s:${ctx.match[1]}:F`)],
        [Markup.button.callback("Back to the windows", "windows")],
      ]),
    });
  });

  bot.action(/^s:(\d+):([RF])$/, async (ctx) => {
    await ctx.answerCbQuery();
    const ws = await windows();
    const w = ws[Number(ctx.match[1])];
    if (!w) return;
    const side = ctx.match[2] === "R" ? "Rise" : "Fall";
    const { u } = store.user(uid(ctx), uname(ctx));
    const max = maxStakeFor(u.sand, PAPER_MAX_STAKE);
    await ctx.editMessageText(
      `A <b>${side}</b> prophecy on <b>${w.asset}</b>.\nYour vault: <b>${u.sand} sand</b>. How much rides on your vision?`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("10", `t:${ctx.match[1]}:${ctx.match[2]}:10`), Markup.button.callback("25", `t:${ctx.match[1]}:${ctx.match[2]}:25`), Markup.button.callback("50", `t:${ctx.match[1]}:${ctx.match[2]}:50`)],
          [Markup.button.callback(`Wager it all (${max})`, `t:${ctx.match[1]}:${ctx.match[2]}:MAX`)],
          [Markup.button.callback("Rethink the vision", `w:${ctx.match[1]}`)],
        ]),
      }
    );
  });

  bot.action(/^t:(\d+):([RF]):(\d+|MAX)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const ws = await windows();
    const w = ws[Number(ctx.match[1])];
    if (!w) return;
    const { u } = store.user(uid(ctx), uname(ctx));
    const side = ctx.match[2] === "R" ? "Rise" : "Fall";
    const stake = ctx.match[3] === "MAX" ? maxStakeFor(u.sand, PAPER_MAX_STAKE) : Number(ctx.match[3]);
    if (stake > u.sand || stake <= 0) {
      await ctx.reply(`Your vault holds ${u.sand} sand — that wager does not fit. Try /alms if you are feeling light.`);
      return;
    }
    const price = w.upPct === null ? 0.5 : side === "Rise" ? w.upPct / 100 : 1 - w.upPct / 100;
    pending.set(uid(ctx), {
      marketId: w.marketId,
      pool: w.pool,
      asset: w.asset,
      minutes: w.minutes,
      expiry: w.expiry,
      side,
      stake,
      price,
    });
    await ctx.editMessageText(
      confirmProphecy({ asset: w.asset, side, stake, price: w.upPct === null ? null : price, toWin: payoutFor(stake, price) }),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Seal it. No take-backs.", "ok"), Markup.button.callback("On reflection, no", "no")],
        ]),
      }
    );
  });

  bot.action("ok", async (ctx) => {
    await ctx.answerCbQuery("Sealing…");
    const p = pending.get(uid(ctx));
    pending.delete(uid(ctx));
    if (!p) {
      await ctx.reply("That vision has faded. Peer again with /play.");
      return;
    }
    const { u } = store.user(uid(ctx), uname(ctx));
    if (p.stake > u.sand) {
      await ctx.reply("The sand shifted under you — insufficient balance now. The rift apologizes. It does not mean it.");
      return;
    }
    const payout = payoutFor(p.stake, p.price ?? 0.5);
    if (u.mode === "live") {
      if (!cfg.hasLiveKey) {
        await ctx.reply(noKeyForLive(), { parse_mode: "HTML" });
        return;
      }
      try {
        const fill = await placeLive({ marketId: p.marketId as `0x${string}`, side: p.side, contracts: Math.min(p.stake, 5) });
        store.adjustSand(u.id, -p.stake);
        const prophecy: Prophecy = {
          id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
          userId: u.id, asset: p.asset, marketId: p.marketId, pool: p.pool,
          side: p.side, stake: p.stake, price: p.price, payout, mode: "live",
          tx: fill.tx, status: "open", createdAt: Date.now(), expiry: p.expiry,
        };
        store.addProphecy(prophecy);
        await ctx.reply(sealed({ side: p.side, asset: p.asset, stake: p.stake, mode: "live", tx: fill.tx }), { parse_mode: "HTML" });
      } catch (e) {
        await ctx.reply(
          `The live rift refused the prophecy: <code>${String((e as Error).message ?? e).slice(0, 180)}</code>\nYour sand is untouched. Practice mode remains gloriously available.`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }
    store.adjustSand(u.id, -p.stake);
    const prophecy: Prophecy = {
      id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      userId: u.id, asset: p.asset, marketId: p.marketId, pool: p.pool,
      side: p.side, stake: p.stake, price: p.price, payout, mode: "paper",
      tx: null, status: "open", createdAt: Date.now(), expiry: p.expiry,
    };
    store.addProphecy(prophecy);
    await ctx.reply(sealed({ side: p.side, asset: p.asset, stake: p.stake, mode: "paper" }), { parse_mode: "HTML" });
  });

  bot.action("no", async (ctx) => {
    await ctx.answerCbQuery();
    pending.delete(uid(ctx));
    await ctx.editMessageText("Unwritten. A wise mage knows when to keep the sand. /play when the visions return.");
  });

  bot.command("vault", async (ctx) => {
    const { u } = store.user(uid(ctx), uname(ctx));
    const open = store.openFor(u.id);
    await ctx.reply(
      vault({ sand: u.sand, rank: rankForXp(u.xp), xp: u.xp, streak: u.streak, best: u.best, open: open.length, settled: u.settled, wins: u.wins }),
      { parse_mode: "HTML" }
    );
  });

  bot.command("scrolls", async (ctx) => {
    const open = store.openFor(uid(ctx));
    if (open.length === 0) {
      await ctx.reply("No open scrolls. Your desk is suspiciously tidy. Fix that with /play.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const lines = open
      .map((p) => `${p.asset} <b>${p.side}</b> · ${p.stake} sand → ${p.payout ?? "?"} · seals in ${closesIn(p.expiry, now)}`)
      .join("\n");
    await ctx.reply(`<b>Open scrolls</b>\n${lines}`, { parse_mode: "HTML" });
  });

  bot.command("leaders", async (ctx) => {
    const rows = store.top(10).map((r) => ({ name: r.name, rank: rankForXp(r.xp), sand: r.sand, streak: r.streak }));
    await ctx.reply(leaders(rows), { parse_mode: "HTML" });
  });

  bot.command("whisper", async (ctx) => {
    const text = (await whisper("BTC")) ?? "The oracle is napping. The book still speaks — check /play.";
    await ctx.reply(whisperText(text), { parse_mode: "HTML" });
  });

  bot.command("alms", async (ctx) => {
    const { u } = store.user(uid(ctx), uname(ctx));
    if (u.sand >= 10) {
      await ctx.reply(`Your vault holds ${u.sand} sand. The rift gives alms only to the truly spent. Admirable restraint, honestly.`);
      return;
    }
    store.adjustSand(u.id, 200 - u.sand);
    await ctx.reply("You beg the rift for sand. The rift, flattered, restores you to <b>200</b>. Spend it like a legend this time.", { parse_mode: "HTML" });
  });

  bot.command("real", async (ctx) => {
    const { u } = store.user(uid(ctx), uname(ctx));
    if (!cfg.hasLiveKey) {
      await ctx.reply(noKeyForLive(), { parse_mode: "HTML" });
      return;
    }
    store.setMode(u.id, "live");
    await ctx.reply(modeLine("live"), { parse_mode: "HTML" });
  });

  bot.command("paper", async (ctx) => {
    const { u } = store.user(uid(ctx), uname(ctx));
    store.setMode(u.id, "paper");
    await ctx.reply(modeLine("paper"), { parse_mode: "HTML" });
  });

  bot.command("redeem", async (ctx) => {
    await ctx.reply("Consulting the settlement stones…");
    const notes = await settlePass(bot);
    await ctx.reply(
      notes.length === 0
        ? "Nothing ripe yet. Open scrolls are still writing themselves. Check /scrolls."
        : `Settled ${notes.length} scroll(s). The vault has been updated — go admire it with /vault.`
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `<b>Chronomancer</b> — declare endings, collect sand.\n\n` +
      `/play — peer into open windows\n/scrolls — your open prophecies\n/vault — balance, rank, timefold\n/leaders — hall of mages\n/whisper — ask the oracle for news-atmosphere\n/alms — beg for sand when broke\n/paper — practice sand\n/real — live testnet rift\n/redeem — settle what has sealed\n/how — the rules, lovingly explained`,
      { parse_mode: "HTML" }
    );
  });

  return bot;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bot = buildBot();
  const settleTimer = setInterval(() => {
    settlePass(bot).catch(() => undefined);
  }, 30_000);
  settleTimer.unref?.();
  const stop = (sig: string) => {
    clearInterval(settleTimer);
    closeExchanges();
    bot.stop(sig);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  bot.catch((err) => console.error("update error:", (err as Error).message ?? err));
  bot
    .launch()
    .then(() => {
      console.log("Chronomancer has opened its eye.");
      windows().catch(() => undefined); // pre-warm the rift so the first /play answers fast
    })
    .catch((e) => {
      console.error("launch failed:", e?.response?.description ?? e?.message ?? e);
      process.exit(1);
    });
}
