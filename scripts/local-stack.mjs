/**
 * Local stack runner and seeder for Claimcheck.
 *
 * Spawns anvil on port 8704 with chain id 968, deploys Claimcheck, and seeds
 * all 4 required scenarios from 04-claimcheck.md §5:
 * 1. 12 recipients including anvil accounts 0–3, accounts 1 and 2 already claimed, expiry 30 days.
 * 2. A campaign created then time-warped past expiry with unclaimed funds (creator acct 0 can reclaim).
 * 3. A 1-recipient campaign (edge n = 1).
 * 4. A 150-recipient campaign (list/table performance check).
 *
 * Usage:
 *   node scripts/local-stack.mjs
 *   npm run dev
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  concat,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbiParameters,
  parseEther,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const PORT = 8704;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968;

const MNEMONIC = "test test test test test test test test test test test junk";

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

// Tree and encoding helpers
function leafOf(index, account, amount) {
  const inner = keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, uint256"), [
      BigInt(index),
      account,
      amount,
    ])
  );
  return keccak256(inner);
}

function pair(a, b) {
  const aNorm = a.toLowerCase();
  const bNorm = b.toLowerCase();
  const sorted = aNorm < bNorm ? [a, b] : [b, a];
  return keccak256(concat(sorted));
}

function buildTree(rows) {
  const n = rows.length;
  const leaves = new Array(n);
  for (let i = 0; i < n; i++) {
    leaves[i] = leafOf(i, rows[i].account, rows[i].amount);
  }

  const layers = [leaves];
  let currentLevel = leaves;
  let len = n;

  while (len > 1) {
    const nextLen = Math.floor((len + 1) / 2);
    const nextLevel = new Array(nextLen);

    for (let k = 0; k < Math.floor(len / 2); k++) {
      const a = currentLevel[2 * k];
      const b = currentLevel[2 * k + 1];
      nextLevel[k] = pair(a, b);
    }

    if (len % 2 === 1) {
      nextLevel[nextLen - 1] = currentLevel[len - 1];
    }

    layers.push(nextLevel);
    currentLevel = nextLevel;
    len = nextLen;
  }

  return { root: currentLevel[0], leaves, layers };
}

function proofFor(tree, index) {
  const n = tree.leaves.length;
  const proof = [];
  let currIdx = index;
  let len = n;

  for (let layerIdx = 0; layerIdx < tree.layers.length - 1; layerIdx++) {
    const layer = tree.layers[layerIdx];
    if (currIdx % 2 === 0) {
      if (currIdx + 1 < len) {
        proof.push(layer[currIdx + 1]);
      }
    } else {
      proof.push(layer[currIdx - 1]);
    }

    len = Math.floor((len + 1) / 2);
    currIdx = Math.floor(currIdx / 2);
  }

  return proof;
}

function encodeList(rows) {
  if (rows.length === 0) return "0x";
  const parts = [];

  for (const row of rows) {
    const cleanAddr = getAddress(row.account);
    const amountHex = row.amount.toString(16).padStart(24, "0");
    parts.push(`0x${cleanAddr.slice(2).toLowerCase()}${amountHex}`);
  }

  return concat(parts);
}

const totalWarp = 3605;
const realNow = Math.floor(Date.now() / 1000);
const initialTimestamp = realNow - totalWarp;

console.log(`Starting anvil on port ${PORT} with initial timestamp ${initialTimestamp} (wall-clock: ${realNow})...`);
spawn("anvil", [
  "--port", String(PORT),
  "--chain-id", String(CHAIN_ID),
  "--accounts", "20",
  "--timestamp", String(initialTimestamp),
  "--silent",
], {
  detached: true,
  stdio: "ignore",
}).unref();

const pub = createPublicClient({ chain: local, transport: http() });

const accounts = Array.from({ length: 10 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);
const wallets = accounts.map((acc) =>
  createWalletClient({ account: acc, chain: local, transport: http() })
);

// Wait for anvil to answer
for (let i = 0; ; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    if (i > 100) throw new Error(`anvil never answered on ${RPC}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const artifact = JSON.parse(
  readFileSync("contracts/out/Claimcheck.sol/Claimcheck.json", "utf8")
);
const abi = artifact.abi;

console.log("Deploying Claimcheck contract...");
const deployHash = await wallets[0].deployContract({
  abi,
  bytecode: artifact.bytecode.object,
  args: [],
  chain: local,
  account: accounts[0],
});
const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
const contractAddress = deployReceipt.contractAddress;
const deployBlock = deployReceipt.blockNumber;

console.log(`Claimcheck deployed at ${contractAddress} (block ${deployBlock})`);

// --- Scenario 1: 12 recipients including anvil accounts 0-3, accts 1 and 2 claimed, expiry 30 days ---
console.log("Seeding Scenario 1: 12-recipient campaign with accounts 1 and 2 claimed...");
const rows1 = [];
let total1 = 0n;
for (let i = 0; i < 12; i++) {
  const accountAddr = i < 4
    ? accounts[i].address
    : getAddress(`0x${(i + 100).toString().padStart(40, "0")}`);
  const amt = parseEther(`${(i + 1) * 2}`);
  total1 += amt;
  rows1.push({ account: accountAddr, amount: amt, index: i });
}
const tree1 = buildTree(rows1);
const list1Hex = encodeList(rows1);

const tx1 = await wallets[0].writeContract({
  address: contractAddress,
  abi,
  functionName: "create",
  args: [30 * 86400, "Community Alpha Distribution", list1Hex],
  value: total1,
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: tx1 });

// Accounts 1 and 2 claim their shares
const proof1_1 = proofFor(tree1, 1);
const claim1_1 = await wallets[1].writeContract({
  address: contractAddress,
  abi,
  functionName: "claim",
  args: [1n, 1, rows1[1].amount, proof1_1],
  chain: local,
  account: accounts[1],
});
await pub.waitForTransactionReceipt({ hash: claim1_1 });

const proof1_2 = proofFor(tree1, 2);
const claim1_2 = await wallets[2].writeContract({
  address: contractAddress,
  abi,
  functionName: "claim",
  args: [1n, 2, rows1[2].amount, proof1_2],
  chain: local,
  account: accounts[2],
});
await pub.waitForTransactionReceipt({ hash: claim1_2 });
console.log("Scenario 1 created (ID: 1, 12 recipients, acct 1 & 2 claimed).");

// --- Scenario 2: Campaign created then time-warped past expiry with unclaimed funds ---
console.log("Seeding Scenario 2: Expired campaign with funds ready for creator reclaim...");
const rows2 = [
  { account: accounts[1].address, amount: parseEther("15"), index: 0 },
  { account: accounts[2].address, amount: parseEther("25"), index: 1 },
];
const total2 = parseEther("40");
const list2Hex = encodeList(rows2);

const tx2 = await wallets[0].writeContract({
  address: contractAddress,
  abi,
  functionName: "create",
  args: [3600, "Early Bird Rewards (Expired)", list2Hex],
  value: total2,
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: tx2 });
console.log("Scenario 2 created (ID: 2). Time-warping 3605 seconds...");
await pub.request({ method: "evm_increaseTime", params: [3605] });
await pub.request({ method: "evm_mine", params: [] });
console.log("Scenario 2 is now expired and reclaimable by creator account 0.");

// --- Scenario 3: 1-recipient campaign (edge n = 1) ---
console.log("Seeding Scenario 3: 1-recipient edge case...");
const rows3 = [
  { account: accounts[3].address, amount: parseEther("50"), index: 0 },
];
const list3Hex = encodeList(rows3);

const tx3 = await wallets[0].writeContract({
  address: contractAddress,
  abi,
  functionName: "create",
  args: [60 * 86400, "Sole Beneficiary Grant", list3Hex],
  value: parseEther("50"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: tx3 });
console.log("Scenario 3 created (ID: 3, n = 1).");

// --- Scenario 4: 150-recipient campaign (list/table performance check) ---
console.log("Seeding Scenario 4: 150-recipient campaign for table performance...");
const rows4 = [];
let total4 = 0n;
for (let i = 0; i < 150; i++) {
  const accountAddr = i === 0
    ? accounts[0].address
    : getAddress(`0x${(i + 1000).toString().padStart(40, "0")}`);
  const amt = parseEther("1");
  total4 += amt;
  rows4.push({ account: accountAddr, amount: amt, index: i });
}
const list4Hex = encodeList(rows4);

const tx4 = await wallets[0].writeContract({
  address: contractAddress,
  abi,
  functionName: "create",
  args: [90 * 86400, "Large Community Airdrop 150", list4Hex],
  value: total4,
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: tx4 });
console.log("Scenario 4 created (ID: 4, 150 recipients).");

// Write .env.local
const envLocal = `NEXT_PUBLIC_CHAIN_ID=968
NEXT_PUBLIC_RPC_URL_968=${RPC}
NEXT_PUBLIC_CONTRACT_968=${contractAddress}
NEXT_PUBLIC_DEPLOY_BLOCK_968=${deployBlock}
NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet
NEXT_PUBLIC_BOHR_RPC=${RPC}
`;
writeFileSync(".env.local", envLocal);
console.log("Wrote .env.local with deployed contract and block number.");

const latestBlock = await pub.getBlock({ blockTag: "latest" });
const currentRealTime = Math.floor(Date.now() / 1000);
const diff = Math.abs(Number(latestBlock.timestamp) - currentRealTime);
console.log(`Chain timestamp: ${latestBlock.timestamp}, wall-clock: ${currentRealTime}, diff: ${diff}s`);
if (diff > 120) {
  throw new Error(`Chain timestamp skewed by ${diff}s (> 120s limit)`);
}

console.log(`
=====================================================
Claimcheck local stack ready:
  RPC:       ${RPC} (Chain ID: ${CHAIN_ID})
  Contract:  ${contractAddress}
  Timestamp: ${latestBlock.timestamp} (diff: ${diff}s from wall clock)
  Seeded:    Campaign 1: 12 recipients (30 days, accounts 1 & 2 claimed)
             Campaign 2: Expired 40 BOT (reclaimable by account 0)
             Campaign 3: 1 recipient edge case (account 3)
             Campaign 4: 150 recipients table performance check

Account Role Table:
  Account 0: ${accounts[0].address} (Creator of all campaigns, can reclaim Campaign 2)
  Account 1: ${accounts[1].address} (Recipient in Campaign 1: ALREADY CLAIMED 4 BOT; in Campaign 2: expired)
  Account 2: ${accounts[2].address} (Recipient in Campaign 1: ALREADY CLAIMED 6 BOT; in Campaign 2: expired)
  Account 3: ${accounts[3].address} (Recipient in Campaign 1: UNCLAIMED 8 BOT; sole recipient in Campaign 3: UNCLAIMED 50 BOT)
=====================================================
`);
