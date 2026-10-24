import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { claimcheckAbi } from "@/lib/botchain/abi";
import {
  buildTree,
  decodeList,
  encodeList,
  loadCampaign,
  proofFor,
  type RecipientRow,
} from "@/lib/claimcheck";

const PORT = 8604;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968 as const;

const MNEMONIC = "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 8 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

let node: ChildProcess;
let publicClient: PublicClient;
let wallets: WalletClient[];
let contractAddress: Address;

function revertDetails(err: unknown): { errorName?: string; args?: readonly unknown[] } | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "data" in e &&
      Boolean((e as { data?: { errorName?: string } }).data?.errorName)
  ) as { data?: { errorName?: string; args?: readonly unknown[] } } | null;
  return found?.data;
}

beforeAll(async () => {
  node = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  publicClient = createPublicClient({ chain: local, transport: http() }) as PublicClient;
  wallets = accounts.map((acc) =>
    createWalletClient({ account: acc, chain: local, transport: http() })
  );

  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error(`anvil never answered on ${RPC}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const artifact = JSON.parse(
    readFileSync("contracts/out/Claimcheck.sol/Claimcheck.json", "utf8")
  ) as { abi: any; bytecode: { object: Hex } };

  const hash = await wallets[0].deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [],
    chain: local,
    account: accounts[0],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  contractAddress = receipt.contractAddress!;
});

afterAll(async () => {
  if (node) {
    node.kill("SIGTERM");
  }
});

describe("Claimcheck live integration on anvil (port 8604)", () => {
  it("deploys cleanly with zero campaigns", async () => {
    expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    const count = await publicClient.readContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "campaignCount",
    });
    expect(count).toBe(0n);
  });

  it("creates an N=7 campaign, verifies root from log, and claims every index", async () => {
    const rows: RecipientRow[] = [];
    let total = 0n;
    for (let i = 0; i < 7; i++) {
      const amt = parseEther(`${i + 1}`);
      total += amt;
      rows.push({
        account: accounts[i].address,
        amount: amt,
        index: i,
      });
    }

    const tree = buildTree(rows);
    const listHex = encodeList(rows);

    const hash = await wallets[0].writeContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "create",
      args: [30 * 86400, "Seven Lucky Recipients", listHex],
      value: total,
      chain: local,
      account: accounts[0],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    // Rebuild and verify from chain logs via loadCampaign
    const loaded = await loadCampaign(publicClient, contractAddress, 1n);
    expect(loaded.campaign.recipients).toBe(7);
    expect(loaded.campaign.funded).toBe(total);
    expect(loaded.campaign.root.toLowerCase()).toBe(tree.root.toLowerCase());
    expect(loaded.rows).toHaveLength(7);

    // Every recipient claims their share with TS-generated proof
    for (let i = 0; i < 7; i++) {
      const proof = proofFor(loaded.tree, i);
      const recipientAcc = accounts[i];
      const balBefore = await publicClient.getBalance({ address: recipientAcc.address });

      const claimHash = await wallets[i].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [1n, i, rows[i].amount, proof],
        chain: local,
        account: recipientAcc,
      });

      const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
      expect(claimReceipt.status).toBe("success");

      const balAfter = await publicClient.getBalance({ address: recipientAcc.address });
      const gasSpent = claimReceipt.gasUsed * claimReceipt.effectiveGasPrice;
      expect(balAfter - balBefore + gasSpent).toBe(rows[i].amount);

      const claimed = await publicClient.readContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "isClaimed",
        args: [1n, i],
      });
      expect(claimed).toBe(true);
    }

    // Bitmap verification: lower 7 bits are 1 -> 0x7F
    const word0 = await publicClient.readContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "claimedWord",
      args: [1n, 0n],
    });
    expect(word0).toBe(0x7fn);

    const cView = await publicClient.readContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "campaignOf",
      args: [1n],
    });
    expect(cView.claimed).toBe(total);
  });

  it("reverts on wrong sender, wrong amount, double claim, and bad index", async () => {
    // Campaign 1 is already fully claimed. Let's create campaign 2 with 2 recipients.
    const rows: RecipientRow[] = [
      { account: accounts[1].address, amount: parseEther("1"), index: 0 },
      { account: accounts[2].address, amount: parseEther("2"), index: 1 },
    ];
    const tree = buildTree(rows);
    const listHex = encodeList(rows);

    await wallets[0].writeContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "create",
      args: [86400, "Negative Tests", listHex],
      value: parseEther("3"),
      chain: local,
      account: accounts[0],
    });

    const proof0 = proofFor(tree, 0);

    // 1. Wrong sender: accounts[3] tries to use accounts[1]'s proof
    await expect(
      wallets[3].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [2n, 0, rows[0].amount, proof0],
        chain: local,
        account: accounts[3],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "BadProof";
    });

    // 2. Wrong amount: accounts[1] claims with wrong amount
    await expect(
      wallets[1].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [2n, 0, parseEther("1.0001"), proof0],
        chain: local,
        account: accounts[1],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "BadProof";
    });

    // 3. Bad index: accounts[1] uses index 99
    await expect(
      wallets[1].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [2n, 99, rows[0].amount, proof0],
        chain: local,
        account: accounts[1],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "BadIndex";
    });

    // 4. Legitimate claim then double claim
    const claimTx = await wallets[1].writeContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "claim",
      args: [2n, 0, rows[0].amount, proof0],
      chain: local,
      account: accounts[1],
    });
    await publicClient.waitForTransactionReceipt({ hash: claimTx });

    // Double claim:
    await expect(
      wallets[1].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [2n, 0, rows[0].amount, proof0],
        chain: local,
        account: accounts[1],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "AlreadyClaimed";
    });
  });

  it("handles expiry and creator reclaim", async () => {
    // Campaign 3: 1 hour duration with accounts[1] allocated 5 BOT
    const rows: RecipientRow[] = [
      { account: accounts[1].address, amount: parseEther("5"), index: 0 },
    ];
    const listHex = encodeList(rows);
    const tree = buildTree(rows);

    await wallets[0].writeContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "create",
      args: [3600, "Expiring Campaign", listHex],
      value: parseEther("5"),
      chain: local,
      account: accounts[0],
    });

    // Reclaim before expiry reverts NotExpired
    await expect(
      wallets[0].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "reclaim",
        args: [3n],
        chain: local,
        account: accounts[0],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "NotExpired";
    });

    // Advance time past expiry (3601 seconds)
    await publicClient.request({
      method: "evm_increaseTime" as any,
      params: [3601] as any,
    });
    await publicClient.request({
      method: "evm_mine" as any,
      params: [] as any,
    });

    // Claim after expiry reverts Expired
    await expect(
      wallets[1].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [3n, 0, rows[0].amount, proofFor(tree, 0)],
        chain: local,
        account: accounts[1],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "Expired";
    });

    // Non-creator reclaim reverts NotCreator
    await expect(
      wallets[1].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "reclaim",
        args: [3n],
        chain: local,
        account: accounts[1],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "NotCreator";
    });

    // Creator reclaims successfully
    const creatorBalBefore = await publicClient.getBalance({ address: accounts[0].address });
    const reclaimHash = await wallets[0].writeContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "reclaim",
      args: [3n],
      chain: local,
      account: accounts[0],
    });
    const reclaimReceipt = await publicClient.waitForTransactionReceipt({ hash: reclaimHash });
    expect(reclaimReceipt.status).toBe("success");

    const creatorBalAfter = await publicClient.getBalance({ address: accounts[0].address });
    const gasSpent = reclaimReceipt.gasUsed * reclaimReceipt.effectiveGasPrice;
    expect(creatorBalAfter - creatorBalBefore + gasSpent).toBe(parseEther("5"));

    // Second reclaim reverts NothingToReclaim
    await expect(
      wallets[0].writeContract({
        address: contractAddress,
        abi: claimcheckAbi,
        functionName: "reclaim",
        args: [3n],
        chain: local,
        account: accounts[0],
      })
    ).rejects.toSatisfy((err) => {
      const details = revertDetails(err);
      return details?.errorName === "NothingToReclaim";
    });
  });

  it("creates a 500-recipient campaign under block gas limit", async () => {
    const rows: RecipientRow[] = [];
    const oneWei = 1n;
    for (let i = 0; i < 500; i++) {
      rows.push({
        account: getAddress(`0x${(i + 1).toString().padStart(40, "0")}`),
        amount: oneWei,
        index: i,
      });
    }

    const listHex = encodeList(rows);
    const hash = await wallets[0].writeContract({
      address: contractAddress,
      abi: claimcheckAbi,
      functionName: "create",
      args: [30 * 86400, "500 Recipients Stress", listHex],
      value: 500n,
      chain: local,
      account: accounts[0],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    // Anvil default block limit is 30M; 500 recipients uses ~7.4M gas
    expect(receipt.gasUsed).toBeLessThan(15_000_000n);
  });
});
