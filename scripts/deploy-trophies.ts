/**
 * Deploy ChronomancerTrophies to Somnia Shannon testnet.
 * Owner is set to HOUSE_ADDRESS (team address) at construction.
 * Needs PRIVATE_KEY (deployer, funded with STT for gas).
 *
 * Run: npm run deploy:trophies
 */
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { cfg, isHouseAddress } from "../src/config.js";

if (!cfg.hasLiveKey || !cfg.privateKey) {
  console.error("Set PRIVATE_KEY in .env (funded Shannon testnet key with STT for gas).");
  process.exit(1);
}

// solc compilation is left to the operator (foundry recommended):
//   forge build --evm-version cancun
// Then place the artifact at contracts/out.json as { abi, bytecode }.
let artifact: { abi: unknown[]; bytecode: `0x${string}` };
try {
  artifact = JSON.parse(readFileSync(new URL("../contracts/out.json", import.meta.url), "utf8"));
} catch {
  console.error(
    "Missing contracts/out.json. Compile first:\n" +
      "  forge init --no-git --force /tmp/chrono-forge (or solc 0.8.28, evm_version cancun)\n" +
      "  forge build, then export { abi, bytecode } to contracts/out.json"
  );
  process.exit(1);
}

const chain = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
} as const;

const account = privateKeyToAccount(cfg.privateKey);
const owner = isHouseAddress(cfg.houseAddress) ? cfg.houseAddress : account.address;
if (owner !== cfg.houseAddress) {
  console.log(`Note: HOUSE_ADDRESS is not a 20-byte address; deployer keeps ownership. House id: ${cfg.houseAddress}`);
}
const wallet = createWalletClient({ chain, transport: http(cfg.rpcUrl), account });
const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

console.log(`Deployer: ${account.address}\nOwner:    ${owner}`);
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [owner],
});
console.log(`Deploy tx: ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`Trophies:  ${receipt.contractAddress}\nStatus:    ${receipt.status}`);
process.exit(receipt.status === "success" ? 0 : 1);
