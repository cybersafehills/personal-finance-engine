import { deriveSyncStatus, explainError } from "../status";

const none = { pending: 0, inFlight: 0, retrying: 0, needsAttention: 0, conflicts: 0 };
const base = { available: true, online: true, syncing: false, summary: none, authNeeded: false };

describe("deriveSyncStatus", () => {
  it("up to date", () => expect(deriveSyncStatus(base).kind).toBe("synced"));
  it("offline with saved changes", () => {
    const s = deriveSyncStatus({ ...base, online: false, summary: { ...none, pending: 2 } });
    expect(s).toMatchObject({ kind: "offline", label: "Offline · 2 saved" });
  });
  it("syncing", () => expect(deriveSyncStatus({ ...base, syncing: true }).kind).toBe("syncing"));
  it("pending", () => expect(deriveSyncStatus({ ...base, summary: { ...none, retrying: 1 } }).label).toBe("1 to sync"));
  it("attention wins over offline", () => expect(deriveSyncStatus({ ...base, online: false, summary: { ...none, needsAttention: 1 } }).kind).toBe("attention"));
  it("auth needed", () => expect(deriveSyncStatus({ ...base, authNeeded: true }).label).toBe("Sign in to sync"));
  it("unavailable build", () => expect(deriveSyncStatus({ ...base, available: false }).kind).toBe("unavailable"));
});
describe("explainError", () => {
  it("never echoes unknown input", () => expect(explainError("<script>")).toBe("This couldn't be sent."));
  it("maps server codes", () => expect(explainError("server_503")).toMatch(/trouble/));
});
