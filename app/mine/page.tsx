"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import PageShell from "@/components/layout/PageShell";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import BotChainGate from "@/components/botchain/BotChainGate";
import { claimcheckAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { describeError, formatDateFromSeconds } from "@/lib/errors";

interface CreatorCampaignView {
  id: bigint;
  expiresAt: number;
  recipients: number;
  funded: bigint;
  claimed: bigint;
  remaining: bigint;
  expired: boolean;
}

export default function MyCampaignsPage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  const { data: campaignIds, refetch: refetchIds } = useReadContract({
    address: deployment?.address,
    abi: claimcheckAbi,
    functionName: "campaignsBy",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && deployment?.address) },
  });

  const [campaigns, setCampaigns] = useState<CreatorCampaignView[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeReclaimId, setActiveReclaimId] = useState<bigint | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchCampaignDetails = useCallback(async () => {
    if (!campaignIds || !publicClient || !deployment?.address) {
      setCampaigns([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const list: CreatorCampaignView[] = [];

      for (const id of campaignIds as bigint[]) {
        const raw = await publicClient.readContract({
          address: deployment.address,
          abi: claimcheckAbi,
          functionName: "campaignOf",
          args: [id],
        });

        const funded = BigInt(raw.funded);
        const claimed = BigInt(raw.claimed);
        const remaining = funded > claimed ? funded - claimed : 0n;
        const now = Math.floor(Date.now() / 1000);
        const expired = now >= Number(raw.expiresAt) || raw.expired;

        list.push({
          id,
          expiresAt: Number(raw.expiresAt),
          recipients: Number(raw.recipients),
          funded,
          claimed,
          remaining,
          expired,
        });
      }

      setCampaigns(list.reverse()); // Newest first
    } catch (err) {
      console.error("Failed to load creator campaigns", err);
    } finally {
      setLoading(false);
    }
  }, [campaignIds, publicClient, deployment]);

  useEffect(() => {
    fetchCampaignDetails();
  }, [fetchCampaignDetails]);

  // Reclaim transaction
  const { data: hash, writeContractAsync, reset: resetWrite } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({ hash });

  const settledHash = useRef<Hex | null>(null);

  useEffect(() => {
    if (!hash || settledHash.current === hash) return;

    if (isConfirmed) {
      settledHash.current = hash;
      setActiveReclaimId(null);
      fetchCampaignDetails();
    } else if (isReceiptError) {
      settledHash.current = hash;
      setActiveReclaimId(null);
      setErrorMessage("Reclaim transaction failed on-chain.");
    }
  }, [hash, isConfirmed, isReceiptError, fetchCampaignDetails]);

  const handleReclaim = async (id: bigint) => {
    if (!deployment?.address) return;
    try {
      setActiveReclaimId(id);
      setErrorMessage(null);
      resetWrite();

      await writeContractAsync({
        address: deployment.address,
        abi: claimcheckAbi,
        functionName: "reclaim",
        args: [id],
      });
    } catch (err) {
      setActiveReclaimId(null);
      setErrorMessage(describeError(err));
    }
  };

  return (
    <PageShell
      title="My Campaigns"
      description="Manage airdrops you created, track claiming activity, and reclaim unclaimed funds after expiry."
      badge="Creator Portfolio"
    >
      <div className="max-w-3xl mx-auto space-y-8">
        <BotChainGate noWalletNote="Connect the wallet you used to publish your campaigns.">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs font-sans text-[#8A4B00]">
              {errorMessage}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center font-serif text-[#46604F]">
              Loading your campaign portfolio...
            </div>
          ) : campaigns.length === 0 ? (
            <Panel className="text-center py-12 space-y-4">
              <h2 className="font-serif text-2xl text-[#10261B]">No campaigns created yet</h2>
              <p className="font-serif text-sm text-[#46604F] max-w-md mx-auto">
                You haven't funded any airdrop distributions from this address.
              </p>
              <Link href="/new" className="inline-block pt-2">
                <Button variant="stepper">Create Your First Airdrop</Button>
              </Link>
            </Panel>
          ) : (
            <div className="space-y-4">
              {campaigns.map((c) => {
                const canReclaim = c.expired && c.remaining > 0n;
                const isReclaiming = activeReclaimId === c.id && isConfirming;

                return (
                  <Panel key={c.id.toString()} variant="register" className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#AFC8B4] pb-3">
                      <div>
                        <span className="text-xs font-mono font-bold text-[#0E4D64]">
                          CAMPAIGN #{c.id.toString()}
                        </span>
                        <h3 className="font-serif text-xl text-[#10261B]">
                          {c.recipients} Recipients Allocation
                        </h3>
                      </div>
                      <div>
                        {c.expired ? (
                          <span className="text-xs font-sans uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-[#8A4B00] border border-amber-300">
                            Expired
                          </span>
                        ) : (
                          <span className="text-xs font-sans uppercase tracking-wider px-2 py-0.5 bg-emerald-100 text-[#1E6B38] border border-emerald-300">
                            Active
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-sans">
                      <div>
                        <span className="text-[#46604F] block">Funded</span>
                        <span className="font-mono text-sm font-bold text-[#10261B]">
                          {formatEther(c.funded)} BOT
                        </span>
                      </div>
                      <div>
                        <span className="text-[#46604F] block">Claimed</span>
                        <span className="font-mono text-sm font-bold text-[#1E6B38]">
                          {formatEther(c.claimed)} BOT
                        </span>
                      </div>
                      <div>
                        <span className="text-[#46604F] block">Remaining</span>
                        <span className="font-mono text-sm font-bold text-[#0E4D64]">
                          {formatEther(c.remaining)} BOT
                        </span>
                      </div>
                      <div>
                        <span className="text-[#46604F] block">Expires</span>
                        <span className="font-mono text-xs text-[#10261B]">
                          {formatDateFromSeconds(c.expiresAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <Link
                        href={`/c/${c.id.toString()}`}
                        className="text-xs font-sans text-[#0E4D64] hover:underline font-bold"
                      >
                        Open Public Claim Page →
                      </Link>

                      {canReclaim && (
                        <Button
                          variant="danger"
                          size="sm"
                          loading={isReclaiming}
                          onClick={() => handleReclaim(c.id)}
                          arrow={false}
                        >
                          {isReclaiming ? "Reclaiming..." : `Reclaim ${formatEther(c.remaining)} BOT`}
                        </Button>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </BotChainGate>
      </div>
    </PageShell>
  );
}
