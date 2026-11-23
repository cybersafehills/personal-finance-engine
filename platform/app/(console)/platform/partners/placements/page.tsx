import Link from "next/link";
import { Icon } from "../../../../../components/ui/Icon";
import { Flash } from "../../../../../components/ui/Flash";
import { Card, ErrorState, PageHeader, StatusPill, buttonCls, ghostButtonCls, inputCls } from "../../../../../components/ui/primitives";
import { can } from "../../../../../lib/console/permissions";
import { consoleRpc, requireSession } from "../../../../../lib/console/access";
import { formatDate } from "../../../../../lib/format";
import { savePlacement, setDelivery } from "../actions";

export const metadata = { title: "Placement settings" };

type Placement = { id: string; enabled: boolean; format: string; mode: string; interval_sec: number; loop: boolean; offer_ids: string[] };
type Res = { delivery_enabled: boolean; placements: Placement[]; approved_offers: { id: string; title: string; advertiser: string; category: string; home_featured: boolean; ends_on: string }[] };
const NAMES: Record<string, { label: string; where: string }> = {
  home: { label: "Home", where: "Above Recent transactions" },
  "pay-person": { label: "Pay a person", where: "Below the Prepare payment button" },
  "pay-merchant": { label: "Pay a merchant", where: "Below the Prepare payment button" },
  plan: { label: "Plan", where: "Under the header" },
  transactions: { label: "Transactions", where: "Under the header, above the list" },
};
const FORMATS = [["wide", "Wide banner (medium-widget proportions)"], ["square", "Square pair (two small-widget cards)"], ["tall", "Tall card"], ["bar", "Slim bar"]];

export default async function PlacementsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const res = await consoleRpc<Res>(session, "console_partner_placements_get");
  const canManage = can(session.access, "manage_partners");
  const canDeliver = can(session.access, "manage_partner_delivery");
  return (
    <>
      <Link href="/platform/partners" className="mb-3 inline-flex items-center gap-1 text-sm text-text-3 hover:text-text"><Icon name="prev" size={14} /> Partners & Placements</Link>
      <PageHeader title="Placement settings" subtitle="Where sponsored content appears in the customer app, how it looks and how it rotates. Customers never see these controls." />
      <Flash ok={sp.ok} err={sp.err} />
      {!res.ok ? <ErrorState message="Placement settings could not be loaded." /> : (
        <>
          <Card title="Delivery to customers" subtitle="Master switch. While OFF, the customer app receives no sponsored content at all, whatever the placements below say." className="mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={res.data.delivery_enabled ? "attention" : "neutral"}>{res.data.delivery_enabled ? "ON: approved offers can reach users" : "OFF: nothing reaches users"}</StatusPill>
              {canDeliver ? (
                <form action={setDelivery}><input type="hidden" name="enabled" value={String(!res.data.delivery_enabled)} /><button className={res.data.delivery_enabled ? ghostButtonCls : buttonCls}>{res.data.delivery_enabled ? "Turn delivery OFF" : "Turn delivery ON"}</button></form>
              ) : <span className="text-sm text-text-3">Only a Platform Owner can change this.</span>}
            </div>
            <p className="mt-2 text-xs text-text-3">Before switching on: approved offers are real, current and reviewed; financial-provider offers carry their disclosure.</p>
          </Card>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {res.data.placements.map((p) => {
              const pool = res.data.approved_offers.filter((o) => p.id !== "home" || o.home_featured);
              return (
                <Card key={p.id} title={NAMES[p.id]?.label ?? p.id} subtitle={NAMES[p.id]?.where}>
                  <form action={savePlacement} className="space-y-3">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={p.enabled} disabled={!canManage} /> Show this placement</label>
                    <label className="block text-sm"><span className="mb-1 block text-text-2">Format</span>
                      <select name="format" defaultValue={p.format} disabled={!canManage} className={`${inputCls} w-full`}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm"><span className="mb-1 block text-text-2">Display</span>
                        <select name="mode" defaultValue={p.mode} disabled={!canManage} className={`${inputCls} w-full`}><option value="carousel">Carousel</option><option value="static">Static</option></select></label>
                      <label className="block text-sm"><span className="mb-1 block text-text-2">Change every (seconds)</span>
                        <input name="interval" type="number" min={3} max={30} defaultValue={p.interval_sec} disabled={!canManage} className={`${inputCls} w-full`} /></label>
                    </div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="loop" defaultChecked={p.loop} disabled={!canManage} /> Loop (otherwise stop on the last creative)</label>
                    <fieldset><legend className="mb-1 text-sm text-text-2">Creatives (none ticked = every approved offer)</legend>
                      {pool.length === 0 ? <p className="text-sm text-text-3">No approved offers yet.</p> : pool.map((o) => (
                        <label key={o.id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" name="offers" value={o.id} defaultChecked={p.offer_ids.includes(o.id)} disabled={!canManage} className="mt-1" />
                          <span>{o.title}<span className="block text-xs text-text-3">{o.advertiser} · {o.category} · ends {formatDate(o.ends_on)}</span></span></label>
                      ))}
                    </fieldset>
                    {canManage ? <button className={buttonCls}>Save {NAMES[p.id]?.label ?? p.id}</button> : null}
                  </form>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
