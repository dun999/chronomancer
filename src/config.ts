import { config } from "dotenv";

config();

function required(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const cfg = {
  botToken: required("TELEGRAM_BOT_TOKEN"),
  rpcUrl: required("RPC_URL", "https://dream-rpc.somnia.network"),
  wsRpcUrl: required("WS_RPC_URL", "wss://api.infra.testnet.somnia.network/ws"),
  indexerUrl: required("INDEXER_URL", "https://dev.smk.somnia.host/v1/graphql"),
  privateKey: (process.env.PRIVATE_KEY ?? "").startsWith("0x")
    ? (process.env.PRIVATE_KEY as `0x${string}`)
    : undefined,
  hasLiveKey:
    !!process.env.PRIVATE_KEY && process.env.PRIVATE_KEY !== "0x..." && process.env.PRIVATE_KEY.length > 10,
  houseAddress: required(
    "HOUSE_ADDRESS",
    "0x2b26de44078e17f008bbc8ed61870edf0d003fb7ee652f7fcd613a4e248f9a8c"
  ) as `0x${string}`,
  serperKey: required("SERPER_API_KEY", ""),
  dataPath: required("DATA_PATH", "./data/chronomancer.json"),
  port: Number(process.env.PORT ?? 3000),
  chainId: 50312,
};

/** Team house id: a 20-byte address doubles as trophy owner; otherwise deployer owns. */
export function isHouseAddress(h: string): h is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(h);
}
export const PAPER_START_SAND = 1000;
export const PAPER_MAX_STAKE = 100;
/** Never route a prophecy into a window closing sooner than this. */
export const MIN_SECONDS_LEFT = 120;
