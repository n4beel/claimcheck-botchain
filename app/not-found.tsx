import Link from "next/link";
import PageShell from "@/components/layout/PageShell";
import Panel from "@/components/ui/Panel";

export default function NotFound() {
  return (
    <PageShell title="Claim not found" description="The requested campaign or check could not be located.">
      <Panel className="text-center py-12 space-y-4">
        <div className="text-4xl font-serif font-bold text-[#0E4D64]">404</div>
        <h2 className="font-serif text-2xl text-[#10261B]">
          Record Not Found
        </h2>
        <p className="font-serif text-sm text-[#46604F] max-w-sm mx-auto">
          The campaign or escrow record you requested does not exist on this network.
        </p>
        <div className="pt-4">
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded bg-[#0E4D64] text-white hover:bg-[#0E4D64]/90 transition-colors"
          >
            ← Return to campaigns
          </Link>
        </div>
      </Panel>
    </PageShell>
  );
}
