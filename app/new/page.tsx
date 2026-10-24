import PageShell from "@/components/layout/PageShell";
import CreateCampaignForm from "@/components/claimcheck/CreateCampaignForm";

export default function NewCampaignPage() {
  return (
    <PageShell
      title="Create an Airdrop"
      description="Commit funds to an auditable recipient ledger. Recipients present their claims directly on-chain."
      badge="Step-by-Step Distribution"
    >
      <div className="max-w-2xl mx-auto py-2">
        <CreateCampaignForm />
      </div>
    </PageShell>
  );
}
