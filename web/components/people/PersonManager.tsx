"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  combinePeopleAction,
  type PersonOption,
  renamePersonAction,
  searchPeopleAction,
  separateTransactionsAction,
  undoCombineAction,
  undoSeparateAction,
} from "../../app/people/actions";
import { KIND_LABEL, type PersonKind } from "../../lib/counterparties/directory";
import { InsightAmount } from "../insights/InsightAmount";

const field =
  "w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent";
const btn =
  "min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-60";
const primary =
  "min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60";

export type PersonTransaction = {
  id: string;
  when: string;
  amount: string;
  title: string;
  status: string | null;
};

type Undo = { kind: "merge" | "split"; eventId: string; message: string };

export function PersonManager({
  personId,
  name,
  kind,
  canWrite,
  transactions,
  totalTransactions,
  page,
  lastPage,
}: {
  personId: string;
  name: string;
  kind: PersonKind;
  canWrite: boolean;
  transactions: PersonTransaction[];
  totalTransactions: number;
  page: number;
  lastPage: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [panel, setPanel] = useState<null | "rename" | "combine" | "separate">(null);

  // rename
  const [newName, setNewName] = useState(name);
  const [newKind, setNewKind] = useState<PersonKind>(kind);
  // combine
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PersonOption[] | null>(null);
  const [picked, setPicked] = useState<PersonOption | null>(null);
  // separate
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitName, setSplitName] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that. Try again.");
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function close() {
    setPanel(null);
    setPicked(null);
    setOptions(null);
    setQuery("");
    setSelected(new Set());
    setSplitName("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selecting = panel === "separate";

  return (
    <div className="flex flex-col gap-5">
      {error
        ? (
          <p role="alert" className="rounded-card border border-attention/30 bg-attention-bg p-3 text-sm text-attention">
            {error}
          </p>
        )
        : null}

      {undo
        ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-3 text-sm text-text-primary">
            <span>{undo.message}</span>
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    undo.kind === "merge"
                      ? undoCombineAction(undo.eventId, personId)
                      : undoSeparateAction(undo.eventId, personId),
                  () => setUndo(null),
                )}
            >
              Undo
            </button>
          </div>
        )
        : null}

      <section aria-labelledby="txns" className="flex flex-col gap-2">
        <h2 id="txns" className="text-sm font-semibold text-text-primary">
          Transactions{" "}
          <span className="font-normal text-text-muted">
            ({totalTransactions}
            {lastPage > 1 ? ` · page ${page} of ${lastPage}` : ""})
          </span>
        </h2>
        {selecting
          ? (
            <p className="text-xs text-text-secondary">
              Tick the transactions that belong to someone else, then name them below. Only the ones on this page are
              listed.
            </p>
          )
          : null}
        {transactions.length === 0
          ? <p className="text-sm text-text-secondary">No transactions on this page.</p>
          : (
            <ul className="flex flex-col gap-2">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface p-3">
                  {selecting
                    ? (
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        aria-label={`${t.title}, ${t.when}`}
                      />
                    )
                    : null}
                  <Link href={`/transactions/${t.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 hover:underline">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium capitalize text-text-primary">{t.title}</span>
                      <span className="text-xs text-text-muted">
                        {t.when}
                        {t.status && t.status !== "settled" ? ` · ${t.status}` : ""}
                      </span>
                    </span>
                    <InsightAmount text={t.amount} className="shrink-0 text-sm font-medium" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      {!canWrite
        ? (
          <p className="text-sm text-text-muted">
            You can look at people here, but only members can rename, combine or separate them.
          </p>
        )
        : (
          <section aria-labelledby="actions" className="flex flex-col gap-3">
            <h2 id="actions" className="text-sm font-semibold text-text-primary">Change this person</h2>
            <p className="text-xs text-text-muted">
              Nothing here edits your transactions. Every change is recorded, and combining or separating can be undone.
            </p>

            {panel === null
              ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={() => setPanel("rename")}>Rename or change type</button>
                  <button type="button" className={btn} onClick={() => setPanel("combine")}>Combine with another</button>
                  <button type="button" className={btn} onClick={() => setPanel("separate")} disabled={transactions.length < 2}>
                    Separate some transactions
                  </button>
                </div>
              )
              : null}

            {panel === "rename"
              ? (
                <form
                  className="flex flex-col gap-3 rounded-card border border-border-subtle p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => renamePersonAction(personId, newName, newKind), close);
                  }}
                >
                  <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
                    Name
                    <input className={field} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} required />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
                    Type
                    <select className={field} value={newKind} onChange={(e) => setNewKind(e.target.value as PersonKind)}>
                      {(Object.keys(KIND_LABEL) as PersonKind[]).map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" className={primary} disabled={pending || newName.trim() === ""}>Save</button>
                    <button type="button" className={btn} onClick={close}>Cancel</button>
                  </div>
                </form>
              )
              : null}

            {panel === "combine"
              ? (
                <div className="flex flex-col gap-3 rounded-card border border-border-subtle p-4">
                  <p className="text-sm text-text-secondary">
                    Find the other entry, and it will be combined into <strong>{name}</strong>. This one is kept.
                  </p>
                  <form
                    className="flex gap-2"
                    role="search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setPicked(null);
                      startTransition(async () => {
                        const res = await searchPeopleAction(query);
                        if (res.ok) {
                          setOptions(res.value.filter((o) => o.id !== personId));
                          setError(null);
                        } else setError(res.error);
                      });
                    }}
                  >
                    <label className="sr-only" htmlFor="combine-q">Find someone to combine</label>
                    <input id="combine-q" className={field} value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" />
                    <button type="submit" className={btn} disabled={pending || query.trim() === ""}>Search</button>
                  </form>
                  {options !== null && options.length === 0
                    ? <p className="text-sm text-text-secondary">Nobody else matches that.</p>
                    : null}
                  {options && options.length > 0
                    ? (
                      <ul className="flex flex-col gap-2">
                        {options.map((o) => (
                          <li key={o.id}>
                            <button
                              type="button"
                              aria-pressed={picked?.id === o.id}
                              onClick={() => setPicked(o)}
                              className={`flex w-full items-center justify-between gap-3 rounded-card border p-3 text-left text-sm ${
                                picked?.id === o.id ? "border-accent bg-surface" : "border-border-subtle"
                              }`}
                            >
                              <span className="font-medium text-text-primary">{o.name}</span>
                              <span className="text-xs text-text-muted">
                                {KIND_LABEL[o.kind]} · {o.txnCount} {o.txnCount === 1 ? "transaction" : "transactions"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                    : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={primary}
                      disabled={pending || !picked}
                      onClick={() =>
                        picked &&
                        run(
                          async () => {
                            const res = await combinePeopleAction(personId, [picked.id]);
                            if (res.ok) {
                              setUndo({ kind: "merge", eventId: res.value, message: `Combined ${picked.name} into ${name}.` });
                              return { ok: true };
                            }
                            return res;
                          },
                          close,
                        )}
                    >
                      {picked ? `Combine ${picked.name} into ${name}` : "Combine"}
                    </button>
                    <button type="button" className={btn} onClick={close}>Cancel</button>
                  </div>
                </div>
              )
              : null}

            {panel === "separate"
              ? (
                <form
                  className="flex flex-col gap-3 rounded-card border border-border-subtle p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const ids = [...selected];
                    run(
                      async () => {
                        const res = await separateTransactionsAction(personId, ids, splitName);
                        if (res.ok) {
                          setUndo({
                            kind: "split",
                            eventId: res.value,
                            message: `Moved ${ids.length} ${ids.length === 1 ? "transaction" : "transactions"} to ${splitName.trim() || "a new person"}.`,
                          });
                          return { ok: true };
                        }
                        return res;
                      },
                      close,
                    );
                  }}
                >
                  <p className="text-sm text-text-secondary">
                    {selected.size === 0
                      ? "Tick the transactions above that belong to someone else."
                      : `${selected.size} selected.`}
                  </p>
                  <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
                    Name for the new person (optional)
                    <input className={field} value={splitName} maxLength={120} onChange={(e) => setSplitName(e.target.value)} />
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" className={primary} disabled={pending || selected.size === 0}>Move them</button>
                    <button type="button" className={btn} onClick={close}>Cancel</button>
                  </div>
                </form>
              )
              : null}
          </section>
        )}
    </div>
  );
}
