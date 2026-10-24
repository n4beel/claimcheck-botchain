import {
  getAddress,
  isAddress,
  keccak256,
  concat,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
  formatEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ENTRY_BYTES, MAX_RECIPIENTS } from "./limits";
import { claimcheckAbi } from "./botchain/abi";

export interface RecipientRow {
  account: Address;
  amount: bigint;
  index?: number;
}

export interface RowError {
  line: number;
  raw: string;
  message: string;
}

export interface ParseListResult {
  rows: RecipientRow[];
  errors: RowError[];
  total: bigint;
  hasDuplicates: boolean;
}

export interface MerkleTree {
  root: Hex;
  leaves: Hex[];
  layers: Hex[][];
}

export interface CampaignData {
  creator: Address;
  expiresAt: number;
  recipients: number;
  root: Hex;
  funded: bigint;
  claimed: bigint;
  createdBlock: bigint;
  expired: boolean;
}

/**
 * Calculates a leaf hash matching Claimcheck.sol:
 * leaf_i = keccak256(bytes.concat(keccak256(abi.encode(uint256(i), address_i, uint256(amount_i)))))
 */
export function leafOf(index: number | bigint, account: Address, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256, address, uint256"),
      [BigInt(index), account, amount]
    )
  );
  return keccak256(inner);
}

/**
 * Sorted pair hash matching Claimcheck.sol:
 * pair(a, b) = keccak256(a < b ? abi.encodePacked(a, b) : abi.encodePacked(b, a))
 */
export function pair(a: Hex, b: Hex): Hex {
  const aNorm = a.toLowerCase();
  const bNorm = b.toLowerCase();
  const sorted = aNorm < bNorm ? [a, b] : [b, a];
  return keccak256(concat(sorted as [Hex, Hex]));
}

/**
 * Builds the Merkle tree with promoted odd node rule matching Claimcheck.sol.
 */
export function buildTree(rows: RecipientRow[]): MerkleTree {
  const n = rows.length;
  if (n === 0) {
    throw new Error("Cannot build tree with zero rows");
  }

  const leaves: Hex[] = new Array(n);
  for (let i = 0; i < n; i++) {
    leaves[i] = leafOf(i, rows[i].account, rows[i].amount);
  }

  const layers: Hex[][] = [leaves];
  let currentLevel = leaves;
  let len = n;

  while (len > 1) {
    const nextLen = Math.floor((len + 1) / 2);
    const nextLevel: Hex[] = new Array(nextLen);

    for (let k = 0; k < Math.floor(len / 2); k++) {
      const a = currentLevel[2 * k];
      const b = currentLevel[2 * k + 1];
      nextLevel[k] = pair(a, b);
    }

    if (len % 2 === 1) {
      nextLevel[nextLen - 1] = currentLevel[len - 1]; // Promoted unchanged
    }

    layers.push(nextLevel);
    currentLevel = nextLevel;
    len = nextLen;
  }

  return {
    root: currentLevel[0],
    leaves,
    layers,
  };
}

/**
 * Generates the Merkle proof for a specific recipient index matching Claimcheck.sol.
 */
export function proofFor(tree: MerkleTree, index: number): Hex[] {
  const n = tree.leaves.length;
  if (index < 0 || index >= n) {
    throw new Error(`Index out of bounds: ${index} (n = ${n})`);
  }

  const proof: Hex[] = [];
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

/**
 * Verifies a proof locally in TypeScript.
 */
export function verifyProof(
  root: Hex,
  index: number,
  account: Address,
  amount: bigint,
  proof: Hex[]
): boolean {
  let h = leafOf(index, account, amount);
  for (const p of proof) {
    h = pair(h, p);
  }
  return h.toLowerCase() === root.toLowerCase();
}

/**
 * Encodes rows into packed 32-byte entries: address (20 bytes) ++ uint96 amount (12 bytes).
 */
export function encodeList(rows: RecipientRow[]): Hex {
  if (rows.length === 0) return "0x";
  const parts: Hex[] = [];

  for (const row of rows) {
    if (row.amount <= 0n) {
      throw new Error(`Amount must be positive: ${row.amount}`);
    }
    if (row.amount >= 1n << 96n) {
      throw new Error(`Amount exceeds uint96: ${row.amount}`);
    }

    const cleanAddr = getAddress(row.account);
    const amountHex = row.amount.toString(16).padStart(24, "0");
    const entryHex = `0x${cleanAddr.slice(2).toLowerCase()}${amountHex}` as Hex;
    parts.push(entryHex);
  }

  return concat(parts);
}

/**
 * Decodes packed 32-byte entries into RecipientRow array.
 */
export function decodeList(listHex: Hex): RecipientRow[] {
  const hex = listHex.startsWith("0x") ? listHex.slice(2) : listHex;
  if (hex.length === 0) return [];

  const charChunk = ENTRY_BYTES * 2; // 64 hex chars per entry
  if (hex.length % charChunk !== 0) {
    throw new Error(`Invalid packed list length: ${hex.length}`);
  }

  const count = hex.length / charChunk;
  const rows: RecipientRow[] = [];

  for (let i = 0; i < count; i++) {
    const chunk = hex.slice(i * charChunk, (i + 1) * charChunk);
    const addrHex = `0x${chunk.slice(0, 40)}`;
    const amtHex = `0x${chunk.slice(40, 64)}`;
    rows.push({
      account: getAddress(addrHex),
      amount: BigInt(amtHex),
      index: i,
    });
  }

  return rows;
}

/**
 * Parses user-supplied text into recipient rows with strict validation and line reporting.
 */
export function parseList(text: string): ParseListResult {
  const lines = text.split(/\r?\n/);
  const rows: RecipientRow[] = [];
  const errors: RowError[] = [];
  let total = 0n;

  const seenMap = new Map<string, number>(); // lowercase address -> line number
  let hasDuplicates = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i].trim();

    // Ignore empty lines and comments starting with '#'
    if (!raw || raw.startsWith("#")) {
      continue;
    }

    // Split on comma, semicolon, tab, or whitespace
    // Allow forms like: "0x..., 1.5" or "0x... 1.5" or "0x...;1.5"
    let parts: string[];
    if (raw.includes(",")) {
      parts = raw.split(",");
    } else if (raw.includes(";")) {
      parts = raw.split(";");
    } else if (raw.includes("\t")) {
      parts = raw.split("\t");
    } else {
      parts = raw.split(/\s+/);
    }

    if (parts.length < 2) {
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: missing amount (expected address, amount)`,
      });
      continue;
    }

    const addrStr = parts[0].trim();
    const amtStr = parts.slice(1).join("").trim();

    if (!isAddress(addrStr)) {
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: "${addrStr}" is not a valid address`,
      });
      continue;
    }

    const cleanAddr = getAddress(addrStr);
    if (cleanAddr === "0x0000000000000000000000000000000000000000") {
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: address cannot be zero`,
      });
      continue;
    }

    let parsedAmt: bigint;
    try {
      parsedAmt = parseEther(amtStr);
    } catch {
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: "${amtStr}" is not a valid BOT amount`,
      });
      continue;
    }

    if (parsedAmt <= 0n) {
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: amount must be greater than zero`,
      });
      continue;
    }

    if (parsedAmt >= 1n << 96n) {
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: amount exceeds maximum allowable value (uint96)`,
      });
      continue;
    }

    const lower = cleanAddr.toLowerCase();
    if (seenMap.has(lower)) {
      hasDuplicates = true;
      errors.push({
        line: lineNum,
        raw,
        message: `Line ${lineNum}: duplicate address ${cleanAddr} (first seen on line ${seenMap.get(lower)})`,
      });
    } else {
      seenMap.set(lower, lineNum);
    }

    total += parsedAmt;
    rows.push({
      account: cleanAddr,
      amount: parsedAmt,
      index: rows.length,
    });
  }

  if (rows.length > MAX_RECIPIENTS) {
    errors.push({
      line: 0,
      raw: "",
      message: `List contains ${rows.length} recipients; maximum allowed is ${MAX_RECIPIENTS}`,
    });
  }

  return {
    rows,
    errors,
    total,
    hasDuplicates,
  };
}

/**
 * Combines entries with identical addresses by summing their amounts.
 */
export function mergeDuplicates(rows: RecipientRow[]): RecipientRow[] {
  const mergedMap = new Map<string, RecipientRow>();

  for (const row of rows) {
    const lower = row.account.toLowerCase();
    const existing = mergedMap.get(lower);
    if (existing) {
      existing.amount += row.amount;
    } else {
      mergedMap.set(lower, {
        account: row.account,
        amount: row.amount,
        index: mergedMap.size,
      });
    }
  }

  const result = Array.from(mergedMap.values());
  // Re-assign 0-based indices
  return result.map((r, idx) => ({ ...r, index: idx }));
}

/**
 * Estimates gas for campaign creation.
 */
export function estimateCreateGas(n: number, titleBytes = 20): bigint {
  return 150_000n + BigInt(n) * 14_500n + BigInt(titleBytes) * 100n;
}

/**
 * Loads a campaign and re-verifies its Merkle commitment from chain logs.
 */
export async function loadCampaign(
  client: PublicClient,
  contractAddress: Address,
  campaignId: bigint
): Promise<{
  campaign: CampaignData;
  rows: RecipientRow[];
  tree: MerkleTree;
  title: string;
}> {
  const rawCampaign = await client.readContract({
    address: contractAddress,
    abi: claimcheckAbi,
    functionName: "campaignOf",
    args: [campaignId],
  });

  const creator = rawCampaign.creator as Address;
  if (!creator || creator === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Campaign #${campaignId} not found`);
  }

  const createdBlock = rawCampaign.createdBlock;

  // Read the CampaignCreated event log at exactly createdBlock
  const logs = await client.getLogs({
    address: contractAddress,
    event: {
      type: "event",
      name: "CampaignCreated",
      inputs: [
        { name: "id", type: "uint256", indexed: true },
        { name: "creator", type: "address", indexed: true },
        { name: "recipients", type: "uint32", indexed: false },
        { name: "funded", type: "uint96", indexed: false },
        { name: "expiresAt", type: "uint64", indexed: false },
        { name: "root", type: "bytes32", indexed: false },
        { name: "title", type: "string", indexed: false },
        { name: "list", type: "bytes", indexed: false },
      ],
    },
    args: {
      id: campaignId,
    },
    fromBlock: createdBlock,
    toBlock: createdBlock,
  });

  if (logs.length === 0) {
    throw new Error(`Creation log not found for campaign #${campaignId} at block ${createdBlock}`);
  }

  const eventArgs = (logs[0] as any).args;
  const title = (eventArgs.title as string) || "";
  const listHex = eventArgs.list as Hex;

  const rows = decodeList(listHex);
  const tree = buildTree(rows);

  if (tree.root.toLowerCase() !== (rawCampaign.root as Hex).toLowerCase()) {
    throw new Error("Recomputed Merkle root does not match contract commitment!");
  }

  return {
    campaign: {
      creator,
      expiresAt: Number(rawCampaign.expiresAt),
      recipients: Number(rawCampaign.recipients),
      root: rawCampaign.root as Hex,
      funded: BigInt(rawCampaign.funded),
      claimed: BigInt(rawCampaign.claimed),
      createdBlock: BigInt(createdBlock),
      expired: rawCampaign.expired,
    },
    rows,
    tree,
    title,
  };
}
