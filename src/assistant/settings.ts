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
};
export const chain = {
  id: 50312, name: 'Somnia Shannon Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: { default: { http: [settings.rpcUrl] } },
} as const;
