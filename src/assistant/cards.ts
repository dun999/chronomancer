import { Resvg } from '@resvg/resvg-js';
import { formatUnits } from 'viem';
import { money } from './math.js';
import type { PositionView } from './types.js';
export function escape(text: string) { return text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
export function cardSvg(p: PositionView, streak: number): string {
  const d = p.market.decimals;
  const color = p.pnl === null ? '#c9c7dd' : BigInt(p.pnl) >= 0n ? '#c1ff72' : '#ff94a6';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#22243b"/><stop offset="1" stop-color="#10121f"/></linearGradient></defs>
  <rect width="1200" height="720" rx="36" fill="url(#bg)"/>
  <circle cx="1120" cy="100" r="220" fill="#b4a0ff" opacity=".05"/>
  <g font-family="DejaVu Sans, sans-serif" fill="#f5f4ff">
  <text x="64" y="76" font-size="25" font-weight="700">CHRONOMANCER</text>
  <rect x="900" y="44" width="235" height="42" rx="21" fill="#35394f"/>
  <text x="1017" y="72" text-anchor="middle" font-size="18" fill="#c6ff87">SOMNIA TESTNET</text>
  <text x="64" y="150" font-size="20" fill="#a9adc6">YOUR POSITION · ${escape(p.status.slice(0,45))}</text>
  <text x="64" y="223" font-size="55" font-weight="700">${escape(p.market.asset.slice(0,18))} / ${p.side.toUpperCase()}</text>
  <text x="64" y="267" font-size="19" fill="#b9bdd2">${escape(p.market.question.slice(0,88))}</text>
  <text x="64" y="341" font-size="18" fill="#a9adc6">UNREALIZED P/L · tUSDC</text>
  <text x="60" y="423" font-size="72" font-weight="700" fill="${color}">${money(p.pnl,d,true)}</text>
  <path d="M64 465 H1136" stroke="#383b52"/>
  <text x="64" y="511" font-size="18" fill="#a9adc6">SHARES ON CHAIN</text>
  <text x="64" y="553" font-size="30">${escape(formatUnits(BigInt(p.balance),d))}</text>
  <text x="460" y="511" font-size="18" fill="#a9adc6">COST BASIS · tUSDC</text>
  <text x="460" y="553" font-size="30">${money(p.cost,d)}</text>
  <text x="854" y="511" font-size="18" fill="#a9adc6">MARK VALUE · tUSDC</text>
  <text x="854" y="553" font-size="30">${money(p.value,d)}</text>
  <text x="64" y="624" font-size="18" fill="#b5a4ff">${streak} DAY CHECK-IN STREAK</text>
  <text x="1136" y="624" font-size="16" text-anchor="end" fill="#a9adc6">${new Date(p.asOf).toISOString().replace('T',' ').slice(0,19)} UTC</text>
  <text x="64" y="670" font-size="15" fill="#8c91ac">${p.indexed ? 'Indexed average-cost estimate. Not an executable exit quote. Excludes gas; test tokens have no cash value.' : 'Indexer catching up. Shares are on-chain; cost and P/L are unavailable until reconciled.'}</text>
  </g></svg>`;
}
export function positionCard(p: PositionView, streak: number): Buffer {
  return Buffer.from(new Resvg(cardSvg(p,streak),{font:{loadSystemFonts:true,defaultFontFamily:'DejaVu Sans'}}).render().asPng());
}
