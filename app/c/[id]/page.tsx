"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, getAddress, isAddress, type Address, type Hex } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import PageShell from "@/components/layout/PageShell";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import BotChainGate from "@/components/botchain/BotChainGate";
import Stepper, { type StepDefinition } from "@/components/claimcheck/Stepper";
import { claimcheckAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { describeError, formatDateFromSeconds, shortAddress } from "@/lib/errors";
import {
  loadCampaign,
  proofFor,
  type CampaignData,
  type RecipientRow,
  type MerkleTree,
} from "@/lib/claimcheck";

type TxStage = "idle" | "signing" | "broadcasting" | "confirmed" | "failed";

export default function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const rawId = resolvedParams.id;
  const campaignId = useMemo(() => {
    try {
      return BigInt(rawId);
    } catch {
      return null;
    }
  }, [rawId]);

  const { address: connectedAccount } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  const { data: userBalance } = useBalance({ address: connectedAccount });

  // Campaign loading state
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [title, setTitle] = useState<string>("");
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);

  // Claimed bits word map (wordIndex -> bigint)
  const [claimedWords, setClaimedWords] = useState<Map<number, bigint>>(new Map());

  // Search filter in public list
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Claim transaction state
  const [stage, setStage] = useState<TxStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: hash, writeContractAsync, reset: resetWrite } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash });

  const settledHash = useRef<Hex | null>(null);
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  const fetchCampaign = useCallback(async () => {
    const client = publicClientRef.current;
    if (!campaignId || !client || !deployment?.address) return;
    try {
      setLoading(true);
      setLoadError(null);

      const loaded = await loadCampaign(client, deployment.address, campaignId);
      setCampaign(loaded.campaign);
      setTitle(loaded.title);
      setRows(loaded.rows);
      setTree(loaded.tree);

      // Fetch claimed status words for all recipients
      const numWords = Math.ceil(loaded.rows.length / 256);
      const wordMap = new Map<number, bigint>();
      for (let w = 0; w < numWords; w++) {
        const wordVal = await client.readContract({
          address: deployment.address,
          abi: claimcheckAbi,
          functionName: "claimedWord",
          args: [campaignId, BigInt(w)],
        });
        wordMap.set(w, wordVal as bigint);
      }
      setClaimedWords(wordMap);
    } catch (err) {
      setLoadError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId, deployment?.address]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  // Settle transaction
  useEffect(() => {
    if (!hash || settledHash.current === hash) return;

    if (isConfirmed && receipt) {
      settledHash.current = hash;
      setStage("confirmed");
      fetchCampaign(); // Refresh status on confirmation
    } else if (isReceiptError) {
      settledHash.current = hash;
      setStage("failed");
      setErrorMessage("Claim transaction failed on-chain.");
    } else if (isConfirming) {
      setStage("broadcasting");
    }
  }, [hash, isConfirmed, isConfirming, isReceiptError, receipt, fetchCampaign]);

  // Check if a row index is claimed using our local word map
  const checkIsClaimed = useCallback(
    (idx: number): boolean => {
      const wordIdx = Math.floor(idx / 256);
      const bitIdx = BigInt(idx % 256);
      const word = claimedWords.get(wordIdx);
      if (word === undefined) return false;
      return (word & (1n << bitIdx)) !== 0n;
    },
    [claimedWords]
  );

  // Match connected address to list
  const userEntry = useMemo(() => {
    if (!connectedAccount || rows.length === 0) return null;
    const lower = connectedAccount.toLowerCase();
    const found = rows.find((r) => r.account.toLowerCase() === lower);
    if (!found) return null;
    const isClaimedAlready = found.index !== undefined ? checkIsClaimed(found.index) : false;
    return {
      ...found,
      isClaimed: isClaimedAlready,
    };
  }, [connectedAccount, rows, checkIsClaimed]);

  const isExpired = useMemo(() => {
    if (!campaign) return false;
    return Math.floor(Date.now() / 1000) >= campaign.expiresAt || campaign.expired;
  }, [campaign]);

  const percentClaimed = useMemo(() => {
    if (!campaign || campaign.funded === 0n) return 0;
    return Number((campaign.claimed * 100n) / campaign.funded);
  }, [campaign]);

  const handleClaim = async () => {
    if (!userEntry || userEntry.index === undefined || !tree || !deployment?.address || !campaignId) {
      return;
    }

    try {
      setStage("signing");
      setErrorMessage(null);
      resetWrite();

      const proof = proofFor(tree, userEntry.index);

      await writeContractAsync({
        address: deployment.address,
        abi: claimcheckAbi,
        functionName: "claim",
        args: [campaignId, userEntry.index, userEntry.amount, proof],
      });
    } catch (err) {
      setStage("failed");
      setErrorMessage(describeError(err));
    }
  };

  // Determine current active step
  const currentStep = useMemo(() => {
    if (!campaign) return 1;
    if (!connectedAccount) return 2;
    if (userEntry) return 3;
    return 2;
  }, [campaign, connectedAccount, userEntry]);

  // Stepper definition
  const steps: StepDefinition[] = [
    {
      number: 1,
      title: "Campaign Allocation",
      summary: campaign ? (
        <span>
          {title || `Campaign #${campaignId}`} · {formatEther(campaign.funded)} BOT ({percentClaimed}% claimed)
        </span>
      ) : undefined,
      content: campaign ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-white border border-[#AFC8B4] text-xs font-sans">
            <div>
              <span className="text-[#46604F] block">Total Funded</span>
              <span className="font-mono text-base font-bold text-[#10261B]">
                {formatEther(campaign.funded)} BOT
              </span>
            </div>
            <div>
              <span className="text-[#46604F] block">Recipients</span>
              <span className="font-mono text-base font-bold text-[#10261B]">
                {campaign.recipients}
              </span>
            </div>
            <div>
              <span className="text-[#46604F] block">Claim Status</span>
              <span className="font-mono text-base font-bold text-[#0E4D64]">
                {percentClaimed}% cleared
              </span>
            </div>
            <div>
              <span className="text-[#46604F] block">Expires</span>
              <span className="font-mono text-xs font-bold text-[#10261B]">
                {isExpired ? "Closed" : formatDateFromSeconds(campaign.expiresAt)}
              </span>
            </div>
          </div>

          <div className="w-full bg-[#AFC8B4]/40 h-2">
            <div
              className="bg-[#0E4D64] h-2 transition-all duration-500"
              style={{ width: `${percentClaimed}%` }}
            />
          </div>

          <div className="text-xs font-sans text-[#46604F] flex flex-wrap items-center justify-between gap-2">
            <span>
              Creator:{" "}
              <a
                href={`https://scan.botchain.ai/address/${campaign.creator}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[#0E4D64] hover:underline"
              >
                {shortAddress(campaign.creator)}
              </a>
            </span>
            <span className="font-mono text-[11px] text-[#46604F]">
              Commitment: {shortAddress(campaign.root)}
            </span>
          </div>
        </div>
      ) : (
        <div className="p-4 text-center font-serif text-sm text-[#46604F]">Loading campaign data...</div>
      ),
    },
    {
      number: 2,
      title: "Recipient Check",
      summary: connectedAccount ? (
        userEntry ? (
          <span className="text-[#1E6B38] font-bold">
            Listed: {formatEther(userEntry.amount)} BOT
          </span>
        ) : (
          <span className="text-[#8A4B00]">Not on distribution list</span>
        )
      ) : undefined,
      content: (
        <div className="space-y-4">
          {!connectedAccount ? (
            <div className="p-4 bg-white border border-[#AFC8B4] space-y-3 text-center sm:text-left">
              <p className="font-serif text-base text-[#10261B]">
                Connect your wallet to check whether your address is included in this distribution.
              </p>
              <BotChainGate noWalletNote="A connected wallet is needed to verify your allocation.">
                <div className="text-xs font-sans text-[#10261B]">
                  Wallet connected. Verifying allocation...
                </div>
              </BotChainGate>
            </div>
          ) : userEntry ? (
            <div className="p-4 bg-emerald-50 border border-emerald-300 text-[#10261B] space-y-2">
              <div className="flex items-center gap-2 text-[#1E6B38] font-bold text-xs uppercase tracking-wide">
                <span>✓</span>
                <span>Address verified on distribution ledger</span>
              </div>
              <p className="font-serif text-xl">
                You're on the list: <strong className="font-mono">{formatEther(userEntry.amount)} BOT</strong>
              </p>
              <p className="text-xs font-sans text-[#46604F]">
                Listed address: <span className="font-mono">{userEntry.account}</span> (Position #{Number(userEntry.index) + 1})
              </p>
            </div>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-300 text-[#8A4B00] space-y-2">
              <p className="font-serif text-base font-semibold">
                This address isn't on the list.
              </p>
              <p className="font-serif text-xs text-[#8A4B00]/90">
                Connected: <span className="font-mono">{shortAddress(connectedAccount)}</span>. If you expect an airdrop from this campaign, switch to your designated recipient wallet.
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      number: 3,
      title: "Present Claim",
      content: (
        <div className="space-y-4">
          {stage === "confirmed" ? (
            <div className="p-4 bg-[#EEF6EE] border-2 border-[#1E6B38] space-y-2 text-[#10261B]">
              <div className="flex items-center gap-2 text-[#1E6B38] font-bold text-xs uppercase tracking-wide">
                <span>✓</span>
                <span>Cleared & Settled</span>
              </div>
              <p className="font-serif text-xl">
                Cleared. {userEntry ? formatEther(userEntry.amount) : ""} BOT is in your wallet.
              </p>
              {hash && (
                <a
                  href={`https://scan.botchain.ai/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-sans text-[#0E4D64] underline underline-offset-2"
                >
                  View settlement receipt on explorer ↗
                </a>
              )}
            </div>
          ) : userEntry?.isClaimed ? (
            <div className="p-4 bg-white border border-[#AFC8B4] text-[#46604F] space-y-1">
              <p className="font-serif text-base text-[#10261B] font-medium">
                This share has already been claimed.
              </p>
              <p className="text-xs font-sans text-[#46604F]">
                The allocated BOT for {shortAddress(userEntry.account)} has already been transferred to this wallet.
              </p>
            </div>
          ) : isExpired ? (
            <div className="p-4 bg-amber-50 border border-amber-300 text-[#8A4B00] space-y-2">
              <p className="font-serif text-base font-semibold">
                This campaign closed on {campaign ? formatDateFromSeconds(campaign.expiresAt) : "expiry"}.
              </p>
              <p className="text-xs font-serif text-[#8A4B00]/90">
                The claim window has lapsed. Any unclaimed funds are reclaimable by the campaign creator.
              </p>
              {connectedAccount && campaign && connectedAccount.toLowerCase() === campaign.creator.toLowerCase() && (
                <Link href="/mine" className="inline-block text-xs font-sans text-[#0E4D64] underline font-bold pt-2">
                  Go to My Campaigns to reclaim →
                </Link>
              )}
            </div>
          ) : userEntry ? (
            <div className="space-y-4">
              {/* Insufficient Gas Warning */}
              {userBalance && userBalance.value < 5_000_000_000_000_000n && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-xs font-sans text-[#8A4B00]">
                  Your wallet holds {formatEther(userBalance.value)} BOT. You may need at least ~0.005 BOT to pay for claim gas.
                </div>
              )}

              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 text-xs font-sans text-[#8A4B00]">
                  {errorMessage}
                </div>
              )}

              <BotChainGate noWalletNote="Wallet required to claim your share.">
                <Button
                  type="button"
                  variant="stepper"
                  disabled={stage === "signing" || stage === "broadcasting"}
                  loading={stage === "signing" || stage === "broadcasting"}
                  onClick={handleClaim}
                >
                  {stage === "signing"
                    ? "Confirm in Wallet..."
                    : stage === "broadcasting"
                    ? "Submitting Merkle Proof..."
                    : `Claim ${formatEther(userEntry.amount)} BOT`}
                </Button>
              </BotChainGate>
            </div>
          ) : (
            <p className="font-serif text-sm text-[#46604F]">
              Only validated recipients on the campaign list can present a claim.
            </p>
          )}
        </div>
      ),
    },
  ];

  // Filtered rows for the public register table
  const filteredRows = useMemo(() => {
    if (!searchFilter.trim()) return rows;
    const filter = searchFilter.trim().toLowerCase();
    return rows.filter((r) => r.account.toLowerCase().includes(filter));
  }, [rows, searchFilter]);

  if (loading) {
    return (
      <PageShell title="Loading Campaign..." description="Fetching commitment from BOT Chain log...">
        <div className="max-w-2xl mx-auto py-12 text-center font-serif text-[#46604F]">
          Reading campaign ledger...
        </div>
      </PageShell>
    );
  }

  if (loadError || !campaign) {
    return (
      <PageShell title="Campaign Not Found" description="Could not load campaign ledger.">
        <div className="max-w-2xl mx-auto py-8 space-y-4">
          <Panel variant="alert">
            <h2 className="font-serif text-xl font-bold mb-2">Unable to Load Campaign</h2>
            <p className="font-serif text-sm mb-4">{loadError || "Campaign does not exist."}</p>
            <Button variant="secondary" size="sm" onClick={() => fetchCampaign()} arrow={false}>
              Retry Loading
            </Button>
          </Panel>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={title || `Campaign #${campaignId}`}
      description="Auditable pull distribution. Each recipient presents an authenticated Merkle proof to withdraw."
      badge={`Campaign #${campaignId}`}
    >
      <div className="max-w-3xl mx-auto space-y-12">
        {/* Recipient Stepper */}
        <Stepper
          steps={steps}
          currentStep={currentStep}
          allowEdit={false}
        />

        {/* Full Public Register Table */}
        <div className="space-y-4 pt-6 border-t border-[#AFC8B4]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-serif text-2xl text-[#10261B]">Public Distribution Register</h3>
              <p className="font-serif text-xs text-[#46604F]">
                Full list of all {rows.length} recipient commitments permanently auditable on-chain.
              </p>
            </div>
            <input
              type="text"
              placeholder="Search address (0x...)"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-[#AFC8B4] font-mono text-xs text-[#10261B] outline-none w-full sm:w-60 focus:border-[#0E4D64]"
            />
          </div>

          <div className="overflow-x-auto border border-[#AFC8B4] bg-[#EEF6EE] max-h-96">
            <table className="register-table">
              <thead>
                <tr>
                  <th style={{ width: "60px" }}>#</th>
                  <th>Recipient Address</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th style={{ width: "110px", textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-[#46604F] font-serif">
                      No matching addresses in this campaign ledger.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, i) => {
                    const idx = r.index ?? i;
                    const claimed = checkIsClaimed(idx);
                    const isYou = connectedAccount && r.account.toLowerCase() === connectedAccount.toLowerCase();

                    return (
                      <tr
                        key={idx}
                        className={isYou ? "bg-[#0E4D64]/10 font-medium" : undefined}
                      >
                        <td className="text-[#46604F] font-mono text-xs">{idx + 1}</td>
                        <td className="font-mono text-xs text-[#10261B]">
                          {r.account}
                          {isYou && (
                            <span className="ml-2 text-[10px] font-sans font-bold uppercase tracking-wider text-[#0E4D64] bg-[#0E4D64]/15 px-1.5 py-0.5">
                              You
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono text-xs text-[#10261B] font-semibold">
                          {formatEther(r.amount)} BOT
                        </td>
                        <td className="text-center">
                          {claimed ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-sans text-[#1E6B38] font-bold">
                              ✓ Claimed
                            </span>
                          ) : (
                            <span className="text-[11px] font-sans text-[#46604F]">
                              Unclaimed
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
