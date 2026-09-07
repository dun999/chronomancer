import { formatUnits, parseUnits } from 'viem';
import type { OrderFill } from '@somnia-chain/markets-sdk';
import type { Side } from './types.js';
export function units(text: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals)
    throw new Error(`Use a positive amount with at most ${decimals} decimals.`);
  const n = parseUnits(text, decimals);
  if (n <= 0n) throw new Error('Amount must be greater than zero.');
  return n;
}
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function sizeBudget(budget: bigint, price: bigint, scale: bigint, lot: bigint, fee = 0n) {
  if (price <= 0n || price >= scale || lot <= 0n) throw new Error('Invalid venue price or grid');
  // Reserve the larger fee on full notional, conservatively, plus raw rounding dust.
  const unitMax = price + ceilDiv(scale * fee, 10_000_000n);
  const quantity = ((budget > 2n ? budget - 2n : 0n) * scale / unitMax / lot) * lot;
  const maxCost = ceilDiv(quantity * unitMax, scale) + (quantity > 0n ? 2n : 0n);
  return { quantity, maxCost };
}
export function receiptFills(fills: OrderFill[], side: Side, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const quantity = fills.reduce((n,f) => n + f.quantityFilled, 0n);
  const cash = fills.reduce((n,f) => n + f.quantityFilled * (side === 'Up' ? f.fillPrice : scale - f.fillPrice) / scale, 0n);
  return { filled: formatUnits(quantity, decimals), cash: formatUnits(cash, decimals) };
}
export function money(raw: string | null, decimals: number, signed = false): string {
  if (raw === null) return 'Awaiting price';
  const n = Number(formatUnits(BigInt(raw), decimals));
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(2)}`;
}
