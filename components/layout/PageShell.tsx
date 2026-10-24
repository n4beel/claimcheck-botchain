"use client";

import Link from "next/link";
import ConnectButton from "@/components/ui/ConnectButton";
import NetworkBadge from "@/components/botchain/NetworkBadge";
import BuiltOnBotChain from "@/components/botchain/BuiltOnBotChain";
import { app } from "@/lib/app-config";

export type NavItem = { href: string; label: string };

interface PageShellProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  badge?: string;
  nav?: NavItem[];
}

/**
 * Claimcheck PageShell — Archetype I · Stepper
 * Minimal banking header without top nav tabs; home page provides two doors.
 */
export default function PageShell({
  children,
  title,
  description,
  badge,
}: PageShellProps) {
  return (
    <div
      className="flex flex-col min-h-[100dvh] overflow-x-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      {/* Top Header Row — No nav tabs */}
      <header className="sticky top-0 z-30 flex-shrink-0 bg-[#DCEBDC]/95 backdrop-blur-sm border-b border-[#AFC8B4]">
        <div className="mx-auto w-full max-w-[960px] px-4 md:px-8 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-[#10261B] hover:opacity-85 no-underline">
            <span className="w-2.5 h-2.5 bg-[#0E4D64] inline-block" aria-hidden="true" />
            <span className="font-serif italic text-xl font-bold tracking-tight text-[#10261B]">
              {app.name}
            </span>
            <span className="hidden sm:inline-block text-xs font-sans font-normal tracking-wide text-[#46604F] pl-2 border-l border-[#AFC8B4]">
              {app.tagline}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/mine"
              className="text-xs font-sans tracking-wide uppercase px-2.5 py-1 text-[#46604F] hover:text-[#0E4D64] transition-colors"
            >
              My Campaigns
            </Link>
            <NetworkBadge />
            <div className="w-[140px] md:w-[170px] flex-shrink-0">
              <ConnectButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-[960px] px-4 py-8 md:px-8 md:py-12">
        {(title || description || badge) && (
          <div className="mb-8 pb-4 border-b border-[#AFC8B4]">
            {badge && (
              <span className="inline-block text-[11px] font-sans font-semibold tracking-wider uppercase text-[#0E4D64] mb-2">
                {badge}
              </span>
            )}
            {title && (
              <h1 className="font-serif text-3xl md:text-4xl text-[#10261B] tracking-tight">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-2 font-serif text-base md:text-lg text-[#46604F] max-w-2xl leading-relaxed">
                {description}
              </p>
            )}
          </div>
        )}
        {children}
      </main>

      {/* Ecosystem Footer */}
      <footer className="flex-shrink-0 border-t border-[#AFC8B4] py-8 bg-[#DCEBDC]">
        <div className="mx-auto w-full max-w-[960px] px-4 md:px-8 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-sans text-[#46604F]">
          <div>
            <span className="font-medium text-[#10261B]">{app.name}</span> — {app.tagline}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-[#0E4D64] inline-block" aria-hidden="true" />
              <BuiltOnBotChain className="text-[11px] uppercase tracking-wider text-[#10261B]" />
            </span>

            <a
              href="https://botchain.ai"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#0E4D64] underline underline-offset-2"
            >
              botchain.ai
            </a>
            <a
              href="https://scan.botchain.ai"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#0E4D64] underline underline-offset-2"
            >
              BOT Chain Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
