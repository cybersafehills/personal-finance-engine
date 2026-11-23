import Link from "next/link";
import { Flash } from "../../../../components/ui/Flash";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatusPill, Tabs, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../components/ui/primitives";
import { can } from "../../../../lib/console/permissions";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatDate, humanizeAction, timeAgo } from "../../../../lib/format";
import { submitOffer } from "./actions";

export const metadata = { title: "Partners & Placements" };

type Row = { id: string; ref: string; title: string; category: string; status: string; advertiser: string; advertiser_kind: string; ends_on: string; expired: boolean; home_featured: boolean; updated_at: string };
type Overview = { delivery_enabled: boolean; counts: Record<string, number>; advertisers: number; live_offers: number };
const TONE: Record<string, Tone> = { in_review: "attention", changes_requested: "info", approved: "positive", paused: "neutral", ended: "neutral", rejected: "danger" };
const TABS = [{ key: "in_review", label: "In review" }, { key: "approved", label: "Approved" }, { key: "active", label: "All active" }, { key: "ended", label: "Ended" }, { key: "rejected", label: "Rejected" }];

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ s?: string; ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.s) ? sp.s! : "in_review";
  const [ov, list] = await Promise.all([
    consoleRpc<Overview>(session, "console_partners_overview"),
    consoleRpc<Row[]>(session, "console_partner_offer_list", { p_status: tab, p_limit: 50 }),
  ]);
  const c = ov.ok ? ov.data.counts : {};
  const rows = list.ok ? list.data : [];
  const canManage = can(session.access, "manage_partners");
  return (
    <>
      <PageHeader title="Partners & Placements" subtitle="Review sponsored offers and control where they appear. Offers are fictional until you approve real ones and switch delivery on."
        actions={<Link href="/platform/partners/placements" className={ghostButtonCls}>Placement settings</Link>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Waiting for review" value={c.in_review ?? 0} tone={(c.in_review ?? 0) > 0 ? "attention" : undefined} href="/platform/partners?s=in_review" />
        <KpiCard label="Live offers" value={ov.ok ? ov.data.live_offers : 0} href="/platform/partners?s=approved" />
        <KpiCard label="Advertisers" value={ov.ok ? ov.data.advertisers : 0} />
        <KpiCard label="Delivery to users" value={ov.ok ? (ov.data.delivery_enabled ? "ON" : "OFF") : "—"} tone={ov.ok && ov.data.delivery_enabled ? "attention" : undefined} href="/platform/partners/placements" />
      </div>
      {canManage ? (
        <Card title="Submit an offer for an advertiser" subtitle="Staff-entered on the advertiser's behalf. Every offer is reviewed before it can be approved." className="mb-4">
          <form action={submitOffer} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <label className="text-sm md:col-span-2"><span className="mb-1 block text-text-2">Advertiser</span><input name="advertiser" required minLength={2} maxLength={120} className={`${inputCls} w-full`} /></label>
            <label className="text-sm"><span className="mb-1 block text-text-2">Advertiser type</span>
              <select name="kind" className={`${inputCls} w-full`}>{["brand", "agency", "organization", "financial_provider"].map((x) => <option key={x} value={x}>{humanizeAction(x)}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block text-text-2">Category</span>
              <select name="category" className={`${inputCls} w-full`}>{["Connectivity", "Learning", "Banking"].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block text-text-2">Ends on</span><input name="ends_on" type="date" required className={`${inputCls} w-full`} /></label>
            <label className="text-sm"><span className="mb-1 block text-text-2">Home featured</span><span className="flex h-9 items-center gap-2"><input name="home_featured" type="checkbox" /> Eligible for Home</span></label>
            <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Headline</span><input name="title" required minLength={3} maxLength={80} className={`${inputCls} w-full`} /></label>
            <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Benefit line</span><input name="benefit" required minLength={3} maxLength={160} className={`${inputCls} w-full`} /></label>
            <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Eligibility</span><input name="eligibility" required minLength={3} maxLength={300} className={`${inputCls} w-full`} /></label>
            <label className="text-sm md:col-span-3"><span className="mb-1 block text-text-2">Destination (https only)</span><input name="destination" type="url" required pattern="https://.*" maxLength={500} className={`${inputCls} w-full`} /></label>
            <label className="text-sm md:col-span-6"><span className="mb-1 block text-text-2">Terms shown to users</span><textarea name="terms" required minLength={10} maxLength={1000} rows={2} className={`${inputCls} h-auto w-full py-2`} /></label>
            <label className="text-sm md:col-span-6"><span className="mb-1 block text-text-2">Financial disclosure (required for Banking / financial providers)</span><textarea name="disclosure" maxLength={600} rows={2} className={`${inputCls} h-auto w-full py-2`} placeholder="State that this is a paid placement, not a OneLedger recommendation or guarantee, and that no return is promised." /></label>
            <div className="md:col-span-6"><button className={buttonCls}>Submit for review</button></div>
          </form>
        </Card>
      ) : null}
      <Tabs label="Offer status" active={tab} items={TABS.map((t) => ({ ...t, href: `/platform/partners?s=${t.key}` }))} />
      <Card padded={false}>
        {!list.ok ? <div className="p-4"><ErrorState message="Offers could not be loaded." /></div> : rows.length === 0 ? <EmptyState message="No offers here." hint="Nothing has been submitted in this state." /> : (
          <div className="p-1"><DataTable caption="Partner offers" columns={["Offer", "Headline", "Advertiser", "Category", "Status", "Ends", "Updated"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{r.ref}</td>
                <td className="px-3 py-2.5"><Link href={`/platform/partners/${r.id}`} className="font-medium text-accent hover:underline">{r.title}</Link></td>
                <td className="px-3 py-2.5 text-text-2">{r.advertiser}<span className="ml-1 text-xs text-text-3">{humanizeAction(r.advertiser_kind)}</span></td>
                <td className="px-3 py-2.5 text-text-2">{r.category}</td>
                <td className="px-3 py-2.5"><StatusPill tone={TONE[r.status]}>{humanizeAction(r.status)}</StatusPill></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{formatDate(r.ends_on)}{r.expired ? " · expired" : ""}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-text-2">{timeAgo(r.updated_at)}</td>
              </tr>
            ))}
          </DataTable></div>
        )}
      </Card>
    </>
  );
}
