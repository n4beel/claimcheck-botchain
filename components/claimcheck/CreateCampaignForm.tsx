"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, type Hex } from "viem";
import { useAccount, useChainId, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import BotChainGate from "@/components/botchain/BotChainGate";
import Stepper, { type StepDefinition } from "@/components/claimcheck/Stepper";
import QrCode from "@/components/claimcheck/QrCode";
import { claimcheckAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { describeError } from "@/lib/errors";
import {
  parseList,
  mergeDuplicates,
  encodeList,
  estimateCreateGas,
  type RecipientRow,
  type RowError,
} from "@/lib/claimcheck";
import {
  DURATION_PRESETS,
  MAX_RECIPIENTS,
  MAX_TITLE_BYTES,
  MIN_DURATION,
  MAX_DURATION,
} from "@/lib/limits";

type TxStage = "idle" | "simulating" | "signing" | "broadcasting" | "confirmed" | "failed";

export default function CreateCampaignForm() {
  const { address } = useAccount();
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  // Stepper state
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Step 1: List
  const [listText, setListText] = useState<string>("");
  const [parseResult, setParseResult] = useState(() => parseList(""));

  const handleListChange = (val: string) => {
    setListText(val);
    setParseResult(parseList(val));
  };

  const handleMerge = () => {
    const merged = mergeDuplicates(parseResult.rows);
    // Format back into text
    const newText = merged
      .map((r) => `${r.account}, ${formatEther(r.amount)}`)
      .join("\n");
    handleListChange(newText);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) {
        handleListChange(content);
      }
    };
    reader.readAsText(file);
  };

  // Step 2: Terms
  const [title, setTitle] = useState<string>("");
  const [durationSeconds, setDurationSeconds] = useState<number>(30 * 86400);
  const [customDays, setCustomDays] = useState<string>("30");

  const titleBytes = useMemo(() => new TextEncoder().encode(title).length, [title]);
  const isTitleValid = titleBytes > 0 && titleBytes <= MAX_TITLE_BYTES;

  // Step 3: Acknowledgement & Submit
  const [acknowledged, setAcknowledged] = useState<boolean>(false);
  const [stage, setStage] = useState<TxStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdCampaignId, setCreatedCampaignId] = useState<bigint | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Wagmi contract write
  const { data: hash, writeContractAsync, reset: resetWrite } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash });

  const settledHash = useRef<Hex | null>(null);

  useEffect(() => {
    if (!hash || settledHash.current === hash) return;

    if (isConfirmed && receipt) {
      settledHash.current = hash;
      setStage("confirmed");

      // Extract campaign ID from CampaignCreated event in receipt logs
      for (const log of receipt.logs) {
        try {
          if (log.topics[0] && log.topics[1]) {
            const idVal = BigInt(log.topics[1]);
            setCreatedCampaignId(idVal);
            break;
          }
        } catch {
          // continue
        }
      }
    } else if (isReceiptError) {
      settledHash.current = hash;
      setStage("failed");
      setErrorMessage("Transaction reverted on-chain.");
    } else if (isConfirming) {
      setStage("broadcasting");
    }
  }, [hash, isConfirmed, isConfirming, isReceiptError, receipt]);

  const handlePublish = async () => {
    if (!deployment?.address) {
      setErrorMessage("Claimcheck contract not deployed on this network.");
      return;
    }
    if (!acknowledged) {
      setErrorMessage("Please check the acknowledgement before publishing.");
      return;
    }

    try {
      setStage("signing");
      setErrorMessage(null);
      resetWrite();

      const encodedList = encodeList(parseResult.rows);

      await writeContractAsync({
        address: deployment.address,
        abi: claimcheckAbi,
        functionName: "create",
        args: [BigInt(durationSeconds), title.trim(), encodedList],
        value: parseResult.total,
      });
    } catch (err) {
      setStage("failed");
      setErrorMessage(describeError(err));
    }
  };

  const claimUrl = useMemo(() => {
    if (!createdCampaignId) return "";
    if (typeof window !== "undefined") {
      return `${window.location.origin}/c/${createdCampaignId}`;
    }
    return `https://claimcheck.botchain-apps.dev/c/${createdCampaignId}`;
  }, [createdCampaignId]);

  const handleCopyLink = useCallback(() => {
    if (!claimUrl) return;
    navigator.clipboard.writeText(claimUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [claimUrl]);

  // Stepper definition
  const steps: StepDefinition[] = [
    {
      number: 1,
      title: "Recipient List",
      summary: parseResult.rows.length > 0 ? (
        <span>
          {parseResult.rows.length} recipients · {formatEther(parseResult.total)} BOT total
        </span>
      ) : undefined,
      content: (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-sans uppercase tracking-wider text-[#46604F]">
                Paste Recipients (Address, Amount in BOT)
              </label>
              <label className="text-xs font-sans text-[#0E4D64] hover:underline cursor-pointer">
                <span>Upload CSV / TXT</span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            </div>
            <textarea
              rows={8}
              value={listText}
              onChange={(e) => handleListChange(e.target.value)}
              placeholder="0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 1.5&#10;0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, 2.0"
              className="w-full bg-white border border-[#AFC8B4] p-3 font-mono text-xs text-[#10261B] focus:border-[#0E4D64] outline-none"
            />
            <p className="text-xs text-[#46604F]">
              Accepts comma, tab, semicolon or space delimiters. Lines starting with # are comments. Maximum 500 recipients.
            </p>
          </div>

          {/* Validation Status & Error Table */}
          {parseResult.errors.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-300 text-[#8A4B00] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-sans font-semibold text-xs uppercase tracking-wider">
                  {parseResult.errors.length} Formatting Issue{parseResult.errors.length > 1 ? "s" : ""}
                </span>
                {parseResult.hasDuplicates && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleMerge}
                  >
                    Merge duplicates
                  </Button>
                )}
              </div>
              <ul className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
                {parseResult.errors.map((err, i) => (
                  <li key={i}>{err.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Clean Parsed Summary */}
          {parseResult.rows.length > 0 && parseResult.errors.length === 0 && (
            <div className="p-4 bg-[#EEF6EE] border border-[#AFC8B4] space-y-2">
              <div className="flex justify-between items-center text-sm font-sans">
                <span className="text-[#46604F]">Recipients Validated</span>
                <span className="font-mono font-bold text-[#10261B]">
                  {parseResult.rows.length} / {MAX_RECIPIENTS}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm font-sans">
                <span className="text-[#46604F]">Total Required Funding</span>
                <span className="font-mono font-bold text-lg text-[#0E4D64]">
                  {formatEther(parseResult.total)} BOT
                </span>
              </div>
            </div>
          )}

          <Button
            type="button"
            variant="stepper"
            disabled={parseResult.rows.length === 0 || parseResult.errors.length > 0}
            onClick={() => setCurrentStep(2)}
          >
            Continue to Terms
          </Button>
        </div>
      ),
    },
    {
      number: 2,
      title: "Campaign Terms",
      summary: title ? (
        <span>
          "{title}" · Expires in {Math.round(durationSeconds / 86400)} days
        </span>
      ) : undefined,
      content: (
        <div className="space-y-6">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-xs font-sans uppercase tracking-wider text-[#46604F]">
                Campaign Title
              </label>
              <span className="text-xs font-mono text-[#46604F]">
                {titleBytes} / {MAX_TITLE_BYTES} bytes
              </span>
            </div>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE_BYTES}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Community Contributor Rewards Q1"
              className="stepper-input font-serif text-lg"
            />
          </div>

          <div className="space-y-3">
            <label className="text-xs font-sans uppercase tracking-wider text-[#46604F]">
              Duration until Expiry
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => {
                    setDurationSeconds(preset.seconds);
                    setCustomDays(String(preset.seconds / 86400));
                  }}
                  className={[
                    "py-2 px-3 text-xs font-sans tracking-wide border text-center transition-colors cursor-pointer",
                    durationSeconds === preset.seconds
                      ? "bg-[#0E4D64] text-white border-[#0E4D64]"
                      : "bg-[#EEF6EE] text-[#10261B] border-[#AFC8B4] hover:border-[#0E4D64]",
                  ].join(" ")}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="pt-2 flex items-center gap-2 text-xs font-sans text-[#46604F]">
              <span>Or custom days:</span>
              <input
                type="number"
                min="1"
                max="365"
                value={customDays}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomDays(val);
                  const days = parseInt(val, 10);
                  if (!isNaN(days) && days >= 1 && days <= 365) {
                    setDurationSeconds(days * 86400);
                  }
                }}
                className="w-20 px-2 py-1 bg-white border border-[#AFC8B4] font-mono text-xs text-[#10261B] outline-none"
              />
              <span>days</span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentStep(1)}
              arrow={false}
              className="w-auto px-4"
            >
              ← Back
            </Button>
            <Button
              type="button"
              variant="stepper"
              disabled={!isTitleValid || durationSeconds < MIN_DURATION || durationSeconds > MAX_DURATION}
              onClick={() => setCurrentStep(3)}
            >
              Continue to Fund & Publish
            </Button>
          </div>
        </div>
      ),
    },
    {
      number: 3,
      title: "Fund & Publish",
      content: (
        <div className="space-y-6">
          {stage === "confirmed" ? (
            /* Done State with Share Link and QR Code */
            <div className="space-y-6 animate-fadeIn">
              <div className="p-4 bg-[#EEF6EE] border-2 border-[#1E6B38] text-[#10261B] space-y-2">
                <div className="flex items-center gap-2 text-[#1E6B38] font-bold text-sm uppercase tracking-wide">
                  <span>✓</span>
                  <span>Campaign Published & Cleared</span>
                </div>
                <p className="font-serif text-lg">
                  Campaign #{createdCampaignId ? String(createdCampaignId) : "Created"} is live on-chain.
                </p>
                <p className="text-xs text-[#46604F]">
                  Share this claim link with your recipients. They can connect and claim their share directly.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-white border border-[#AFC8B4]">
                <QrCode value={claimUrl} size={150} />
                <div className="flex-1 space-y-3 w-full">
                  <label className="text-xs font-sans uppercase tracking-wider text-[#46604F]">
                    Shareable Claim Link
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={claimUrl}
                      className="w-full font-mono text-xs p-2.5 bg-[#EEF6EE] border border-[#AFC8B4] text-[#10261B] outline-none"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleCopyLink}
                      arrow={false}
                    >
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="pt-2">
                    <Link
                      href={`/c/${createdCampaignId}`}
                      className="text-xs font-sans uppercase tracking-wider text-[#0E4D64] hover:underline font-bold"
                    >
                      View Campaign Page →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Pre-Publish Review & Gate */
            <div className="space-y-6">
              <div className="space-y-3 p-4 bg-white border border-[#AFC8B4]">
                <h3 className="font-serif text-lg font-medium text-[#10261B] border-b border-[#AFC8B4] pb-2">
                  Distribution Ledger Summary
                </h3>
                <div className="grid grid-cols-2 gap-y-2 text-xs font-sans">
                  <span className="text-[#46604F]">Title</span>
                  <span className="font-medium text-[#10261B] truncate">{title}</span>

                  <span className="text-[#46604F]">Recipients Count</span>
                  <span className="font-mono text-[#10261B]">{parseResult.rows.length}</span>

                  <span className="text-[#46604F]">Expiry Date</span>
                  <span className="font-mono text-[#10261B]">
                    {new Date(Date.now() + durationSeconds * 1000).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>

                  <span className="text-[#46604F]">Estimated Gas</span>
                  <span className="font-mono text-[#10261B]">
                    ~{estimateCreateGas(parseResult.rows.length, titleBytes).toLocaleString()} gas
                  </span>

                  <span className="text-[#46604F] pt-2 border-t border-[#AFC8B4] font-bold">
                    Required Funding
                  </span>
                  <span className="font-mono text-lg text-[#0E4D64] pt-2 border-t border-[#AFC8B4] font-bold">
                    {formatEther(parseResult.total)} BOT
                  </span>
                </div>
              </div>

              {/* Mandatory Acknowledgement Checkbox */}
              <label className="flex items-start gap-3 p-3 bg-[#EEF6EE] border border-[#AFC8B4] cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1 accent-[#0E4D64] w-4 h-4 cursor-pointer"
                />
                <span className="font-serif text-xs md:text-sm text-[#10261B] leading-relaxed select-none">
                  I understand this list is public, the amount is locked until it expires, and I can't edit it.
                </span>
              </label>

              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 text-xs font-sans text-[#8A4B00]">
                  {errorMessage}
                </div>
              )}

              <div className="space-y-3">
                <BotChainGate noWalletNote="Connecting your wallet is required to fund and publish this airdrop.">
                  <Button
                    type="button"
                    variant="stepper"
                    disabled={!acknowledged || stage === "signing" || stage === "broadcasting"}
                    loading={stage === "signing" || stage === "broadcasting"}
                    onClick={handlePublish}
                  >
                    {stage === "signing"
                      ? "Sign in Wallet..."
                      : stage === "broadcasting"
                      ? "Clearing on BOT Chain..."
                      : `Publish & Fund ${formatEther(parseResult.total)} BOT`}
                  </Button>
                </BotChainGate>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCurrentStep(2)}
                  arrow={false}
                  className="w-auto px-4"
                >
                  ← Back to Terms
                </Button>
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      <Stepper
        steps={steps}
        currentStep={currentStep}
        onEditStep={(step) => {
          if (stage !== "confirmed") {
            setCurrentStep(step);
          }
        }}
        allowEdit={stage !== "confirmed"}
      />
    </div>
  );
}
