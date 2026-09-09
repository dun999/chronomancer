import 'dotenv/config';
import { aiConfig } from './ai-config.js';
import { resolve } from 'node:path';
import { SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
export const settings = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? '',
  dataDir: resolve(process.env.ASSISTANT_DATA_DIR ?? './data/assistant'),
  masterKey: process.env.WALLET_MASTER_KEY ?? '',
  ...aiConfig(process.env),
  newsKey: process.env.SERPER_API_KEY ?? '',
  rpcUrl: process.env.RPC_URL ?? 'https://dream-rpc.somnia.network',
  wsRpcUrl: process.env.WS_RPC_URL ?? 'wss://api.infra.testnet.somnia.network/ws',
  indexerUrl: process.env.INDEXER_URL ?? 'https://dev.smk.somnia.host/v1/graphql',
  venueId: process.env.DREAMDEX_VENUE_ID ?? '',
  collateral: SOMNIA_TESTNET_ADDRESSES.testUsdc!,
  explorer: 'https://shannon-explorer.somnia.network',
  faucet: 'https://testnet.somnia.network',
  collateralFaucet: 'https://t.me/+XHq0F0JXMyhmMzM0',
  maxBudget: '100',
  minSeconds: 120,
  // Telegraf aborts a handler at `handlerTimeout` and, by default, that abort
  // tears down long polling. The internal budgets below must always expire
  // first so the user gets an answer and the poller keeps running:
  // markets + news + two AI attempts < handlerTimeoutMs.
  handlerTimeoutMs: Math.max(Number(process.env.HANDLER_TIMEOUT_MS) || 150_000, 30_000),
  // The live indexer needs 8-16s for a full page of eight markets and their
  // books, so this is roughly double the worst measured read, not a tight cap.
  marketTimeoutMs: Math.max(Number(process.env.MARKET_TIMEOUT_MS) || 35_000, 5_000),
  newsTimeoutMs: Math.max(Number(process.env.NEWS_TIMEOUT_MS) || 5_000, 1_000),
};
export const chain = {
  id: 50312, name: 'Somnia Shannon Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: { default: { http: [settings.rpcUrl] } },
} as const;
