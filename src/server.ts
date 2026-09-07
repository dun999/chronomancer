import { createServer } from "http";
import { cfg } from "./config.js";
import { Store } from "./store.js";
import { rankForXp } from "./game.js";

/** Tiny dependency-free status page: health + hall of mages. */
const store = new Store();

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: "chronomancer", chainId: cfg.chainId, live: cfg.hasLiveKey }));
    return;
  }
  const rows = store
    .top(25)
    .map(
      (u, i) =>
        `<tr><td>${i + 1}</td><td>${u.name}</td><td>${u.sand}</td><td>${rankForXp(u.xp)}</td><td>x${u.streak}</td></tr>`
    )
    .join("");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Chronomancer — Hall of Mages</title>` +
      `<style>body{font-family:Georgia,serif;max-width:640px;margin:3rem auto;padding:0 1rem;color:#e8e2d5;background:#14101c}table{width:100%;border-collapse:collapse}td,th{padding:.4rem;border-bottom:1px solid #3a3048;text-align:left}h1{font-style:italic}</style></head>` +
      `<body><h1>Chronomancer</h1><p>The timelines, ranked by sand. Play in Telegram.</p>` +
      `<table><tr><th>#</th><th>Mage</th><th>Sand</th><th>Rank</th><th>Fold</th></tr>${rows || `<tr><td colspan=5>No mages yet.</td></tr>`}</table></body></html>`
  );
}).listen(cfg.port, () => console.log(`Chronomancer hall on :${cfg.port}`));
