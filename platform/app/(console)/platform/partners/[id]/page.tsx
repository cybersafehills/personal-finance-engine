import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../../components/ui/Icon";
import { Flash } from "../../../../../components/ui/Flash";
import { Card, ErrorState, PageHeader, StatusPill, buttonCls, ghostButtonCls, inputCls, type Tone } from "../../../../../components/ui/primitives";
import { can } from "../../../../../lib/console/permissions";
import { consoleRpc, requireSession } from "../../../../../lib/console/access";
import { formatDate, formatDateTime, humanizeAction } from "../../../../../lib/format";
import { decideOffer } from "../actions";

export const metadata = { title: "Partner offer" };

type Ev = { id: string; kind: string; actor_role: string | null; actor_email: string | null; note: string | null; from_status: string | null; to_status: string | null; created_at: string };
type Offer = { id: string; ref: string; advertiser: string; advertiser_kind: string; category: string; title: string; benefit: string; eligibility: string; terms: string; destination_url: string; country: string; language: string; ends_on: string; home_featured: boolean; financial_disclosure: string | null; status: string; review_note: string | null; expired: boolean; events: Ev[] };
const TONE: Record<string, Tone> = { in_review: "attention", changes_requested: "info", approved: "positive", paused: "neutral", ended: "neutral", rejected: "danger" };
const ACTIONS: Record<string, { decision: string; label: string; needsNote: boolean }[]> = {
  in_review: [{ decision: "approve", label: "Approve", needsNote: true }, { decision: "request_changes", label: "Request changes", needsNote: true }, { decision: "reject", label: "Reject", needsNote: true }],
  changes_requested: [{ decision: "reject", label: "Reject", needsNote: true }],
  approved: [{ decision: "pause", label: "Pause", needsNote: false }, { decision: "end", label: "End", needsNote: false }],
  paused: [{ decision: "resume", label: "Resume", needsNote: false }, { decision: "end", label: "End", needsNote: false }],
};
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div><dt className="text-xs text-text-3">{label}</dt><dd className="mt-0.5 text-sm text-text">{children}</dd></div>;

export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const session = await requireSession();
  const r = await consoleRpc<Offer>(session, "console_partner_offer_get", { p_id: id });
  if (!r.ok) return (<><PageHeader title="Partner offer" /><ErrorState message="This offer could not be loaded." /></>);
  const o = r.data;
  const financial = o.category === "Banking";
  const canManage = can(session.access, "manage_partners");
  const canApproveFinancial = can(session.access, "approve_financial_partners");
  const actions = (ACTIONS[o.status] ?? []).filter((a) => !(financial && ["approve", "resume"].includes(a.decision) && !canApproveFinancial));
  return (
    <>
      <Link href="/platform/partners" className="mb-3 inline-flex items-center gap-1 text-sm text-text-3 hover:text-text"><Icon name="prev" size={14} /> All offers</Link>
      <PageHeader title={o.title} subtitle={`${o.ref} · ${o.advertiser} (${humanizeAction(o.advertiser_kind)}) · ends ${formatDate(o.ends_on)}${o.expired ? " · expired" : ""}`} actions={<StatusPill tone={TONE[o.status]}>{humanizeAction(o.status)}</StatusPill>} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <Card title="What users would see" subtitle="Labelled Sponsored in the app. Review the claim, eligibility, terms and destination before approving.">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Headline">{o.title}</Field><Field label="Category">{o.category}</Field>
              <Field label="Benefit">{o.benefit}</Field><Field label="Eligibility">{o.eligibility}</Field>
              <Field label="Country · language">{o.country} · {o.language}</Field><Field label="Home placement">{o.home_featured ? "Eligible" : "Not eligible"}</Field>
              <div className="sm:col-span-2"><Field label="Terms"><span className="whitespace-pre-wrap">{o.terms}</span></Field></div>
              <div className="sm:col-span-2"><Field label="Destination (shown before leaving OneLedger)"><span className="break-all font-mono text-xs">{o.destination_url}</span></Field></div>
              {financial ? <div className="sm:col-span-2"><Field label="Financial promotion disclosure"><span className="whitespace-pre-wrap">{o.financial_disclosure}</span></Field></div> : null}
            </dl>
          </Card>
          <Card title="Review history" subtitle="Append-only. Entries cannot be edited or removed.">
            <ol className="space-y-4">
              {o.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm"><span className="font-medium">{humanizeAction(e.kind)}{e.from_status ? `: ${humanizeAction(e.from_status)} → ${humanizeAction(e.to_status ?? "")}` : ""}</span>
                      <span className="ml-2 text-xs text-text-3">{e.actor_email ?? e.actor_role} · {formatDateTime(e.created_at)}</span></p>
                    {e.note ? <p className="mt-1 whitespace-pre-wrap rounded-control bg-surface-muted px-3 py-2 text-sm text-text-2">{e.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          {canManage && actions.length ? (
            <Card title="Decision" subtitle={financial ? "Financial provider: identity, authorization evidence, claims and disclosure need a Platform Owner. Approval does not mean OneLedger guarantees the product." : "A short note is required to approve, request changes or reject."}>
              <form action={decideOffer} className="space-y-2">
                <input type="hidden" name="id" value={o.id} />
                <textarea name="note" maxLength={500} rows={3} placeholder="Review note (10+ characters to approve, request changes or reject)" className={`${inputCls} h-auto w-full py-2`} aria-label="Review note" />
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => <button key={a.decision} name="decision" value={a.decision} className={i === 0 ? buttonCls : ghostButtonCls}>{a.label}</button>)}
                </div>
              </form>
            </Card>
          ) : financial && o.status === "in_review" ? <Card title="Decision"><p className="text-sm text-text-2">Banking offers can be approved only by a Platform Owner.</p></Card> : null}
          <Link href="/platform/partners/placements" className={`${ghostButtonCls} w-full`}>Placement settings</Link>
        </div>
      </div>
    </>
  );
}
