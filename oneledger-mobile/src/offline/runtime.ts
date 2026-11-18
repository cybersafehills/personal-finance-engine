import type { SqlDb } from "./sql";

// A process-wide handle to the open local database, so plain (non-React) query
// functions can read from it. Reads prefer the device copy only once its first
// full download has completed; before that they use the server, as before.

type Runtime = { db: SqlDb; userId: string; bootstrapped: boolean } | null;

let current: Runtime = null;
const listeners = new Set<() => void>();

export function setOfflineRuntime(next: Runtime) {
  current = next;
  listeners.forEach((l) => l());
}
export function getOfflineRuntime(): Runtime {
  return current;
}
/** The local DB, only if it holds a complete first download. */
export function readableDb(): SqlDb | null {
  return current?.bootstrapped ? current.db : null;
}
/** The local DB whenever open (for writes: saving locally never needs a download). */
export function writableDb(): SqlDb | null {
  return current?.db ?? null;
}
export function subscribeRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

let writeHandler: (() => void) | null = null;
/** The provider registers here; feature code calls localWritten() after saving on the device. */
export function setLocalWriteHandler(handler: (() => void) | null) {
  writeHandler = handler;
}
export function localWritten() {
  writeHandler?.();
}
