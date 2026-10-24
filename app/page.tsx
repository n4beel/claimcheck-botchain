"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/layout/PageShell";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

export default function HomePage() {
  const router = useRouter();
  const [claimInput, setClaimInput] = useState("");

  const handleClaimLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = claimInput.trim();
    if (!trimmed) return;

    // Check if user entered full URL like https://.../c/123 or just 123
    const match = trimmed.match(/\/c\/(\d+)/);
    if (match) {
      router.push(`/c/${match[1]}`);
    } else {
      const cleanId = trimmed.replace(/[^0-9]/g, "");
      if (cleanId) {
        router.push(`/c/${cleanId}`);
      }
    }
  };

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto space-y-12 py-4">
        {/* Header Intro */}
        <div className="space-y-3 text-center sm:text-left border-b border-[#AFC8B4] pb-8">
          <span className="text-xs font-sans uppercase tracking-widest text-[#0E4D64] font-semibold">
            Pull-Based Airdrop Engine
          </span>
          <h1 className="font-serif text-4xl md:text-5xl text-[#10261B] tracking-tight">
            Airdrop by claim, not by push.
          </h1>
          <p className="font-serif text-lg text-[#46604F] leading-relaxed">
            Senders fund a distribution commitment with zero gas wasted on inactive recipients.
            Recipients present their claim when ready.
          </p>
        </div>

        {/* The Two Doors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Door 1: Send an airdrop */}
          <div className="p-6 bg-[#EEF6EE] border-2 border-[#AFC8B4] hover:border-[#0E4D64] transition-colors flex flex-col justify-between space-y-6">
            <div className="space-y-2">
              <span className="font-mono text-xs text-[#0E4D64] font-bold">DOOR 1</span>
              <h2 className="font-serif text-2xl text-[#10261B]">Send an airdrop</h2>
              <p className="font-serif text-sm text-[#46604F] leading-relaxed">
                Send an airdrop — recipients claim their own share. Paste your recipient list, fund the total in BOT, and publish the campaign commitment.
              </p>
            </div>
            <Link href="/new" className="w-full no-underline">
              <Button variant="stepper" className="w-full">
                Create Airdrop
              </Button>
            </Link>
          </div>

          {/* Door 2: Claim one */}
          <div className="p-6 bg-[#EEF6EE] border-2 border-[#AFC8B4] hover:border-[#0E4D64] transition-colors flex flex-col justify-between space-y-6">
            <div className="space-y-2">
              <span className="font-mono text-xs text-[#0E4D64] font-bold">DOOR 2</span>
              <h2 className="font-serif text-2xl text-[#10261B]">Claim one</h2>
              <p className="font-serif text-sm text-[#46604F] leading-relaxed">
                Claim one — you need the link or the number. Enter your campaign reference or claim link to check your allocation and withdraw.
              </p>
            </div>
            <form onSubmit={handleClaimLookup} className="space-y-3">
              <input
                type="text"
                placeholder="Campaign # or claim URL"
                value={claimInput}
                onChange={(e) => setClaimInput(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-[#AFC8B4] font-mono text-xs text-[#10261B] outline-none focus:border-[#0E4D64]"
              />
              <Button
                type="submit"
                variant="stepper"
                disabled={!claimInput.trim()}
                className="w-full"
              >
                Open Campaign
              </Button>
            </form>
          </div>
        </div>

        {/* Limits & Rules */}
        <Panel variant="inset" className="space-y-3">
          <span className="font-sans font-bold text-xs uppercase tracking-wider text-[#10261B]">
            System Operational Limits
          </span>
          <p className="font-serif text-sm text-[#46604F] leading-relaxed">
            Public list. Fixed amounts. No edits. Unclaimed funds return to the sender only after expiry.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-[#AFC8B4] text-xs font-sans text-[#46604F]">
            <div>
              <span className="block text-[#10261B] font-bold font-mono">500</span>
              <span>Max recipients</span>
            </div>
            <div>
              <span className="block text-[#10261B] font-bold font-mono">1h – 365d</span>
              <span>Expiry window</span>
            </div>
            <div>
              <span className="block text-[#10261B] font-bold font-mono">Native BOT</span>
              <span>Supported asset</span>
            </div>
            <div>
              <span className="block text-[#10261B] font-bold font-mono">Pull-based</span>
              <span>Recipient pays gas</span>
            </div>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
