import { cfg } from "./config.js";

interface CacheEntry {
  at: number;
  text: string;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000;

function bluntTitles(titles: string[]): string {
  const first = titles[0]?.replace(/\s+/g, " ").trim().slice(0, 90) ?? "";
  if (!first) return "The broadsheets are quiet. Suspiciously quiet.";
  if (titles.length === 1) return `The broadsheets murmur only of this: ${first}.`;
  return `The broadsheets murmur of ${first} — and ${titles.length - 1} other omen(s). Take that as atmosphere, not advice.`;
}

/**
 * One line of BTC news context in the wizard's voice. Returns null when
 * unavailable (no key, network hiccup) — callers fall back to market-only copy.
 * Never financial advice; cached 10 minutes.
 */
export async function whisper(asset: string): Promise<string | null> {
  if (!cfg.serperKey) return null;
  const key = asset.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": cfg.serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `${asset} crypto price`, num: 3 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { news?: Array<{ title?: string }> };
    const titles = (data.news ?? []).map((n) => n.title ?? "").filter(Boolean).slice(0, 3);
    const text = bluntTitles(titles);
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch {
    return null;
  }
}
