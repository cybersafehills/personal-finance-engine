import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { SuggestForm } from "../../../components/directory/SuggestForm";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isDirectorySuggestionsEnabled } from "../../../lib/pay/gate";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function SuggestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  if (!isDirectorySuggestionsEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Suggest an update" backHref="/pay/ussd" backLabel={messages().ussd.title} />
        <EmptyState
          title="Suggestions aren't open yet"
          description="We'll open this once the review process is ready. Thanks for wanting to help."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const type = typeof sp.type === "string" ? sp.type : undefined;
  const network = typeof sp.network === "string" ? sp.network : undefined;

  return (
    <div>
      <PageHeader
        title="Suggest an update"
        subtitle="Tell us about a code, route, or fee that's missing or wrong. Nothing you send is published without verification."
        backHref="/pay/ussd"
        backLabel={messages().ussd.title}
      />
      <SuggestForm defaultType={type} defaultNetworkSlug={network} />
    </div>
  );
}
