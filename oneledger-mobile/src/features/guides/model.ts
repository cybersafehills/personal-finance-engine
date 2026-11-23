export const GUIDE_IDS = ["orientation", "recording", "transaction", "inbox", "plan", "documents", "pay", "spaces", "wallets", "add", "details", "spending", "people", "goals", "categories", "scan", "requests", "statements", "profile", "appearance", "security", "insights", "bills", "activity", "templates", "ussd"] as const;
export type GuideId = typeof GUIDE_IDS[number];
export type GuideProgress = { status: "paused" | "completed"; step: number; revision?: number; stepId?: string };
export type GuideState = { version: 1; welcomeSeen: boolean; dismissed: GuideId[]; progress: Partial<Record<GuideId, GuideProgress>> };
export const emptyGuides = (): GuideState => ({ version: 1, welcomeSeen: false, dismissed: [], progress: {} });
export const guideStorageKey = (userId: string) => `oneledger.guides.v1.${userId}`;
export function readGuides(raw: string | null): GuideState {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || value.version !== 1) return emptyGuides();
    const next = emptyGuides();
    next.welcomeSeen = value.welcomeSeen === true;
    next.dismissed = GUIDE_IDS.filter(id => Array.isArray(value.dismissed) && value.dismissed.includes(id));
    for (const id of GUIDE_IDS) {
      const entry = value.progress?.[id];
      if (entry && ["paused", "completed"].includes(entry.status) && Number.isInteger(entry.step) && entry.step >= 0 && entry.step < 1000) {
        next.progress[id] = { status: entry.status, step: entry.step, ...([2, 3].includes(entry.revision) && typeof entry.stepId === "string" && entry.stepId.length < 100 ? { revision: entry.revision, stepId: entry.stepId } : {}) };
      }
    }
    return next;
  } catch { return emptyGuides(); }
}
export function canOfferWelcome(createdAt: string | undefined, now: number): boolean {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(created) && created <= now && now - created < 7 * 86400000;
}
export type Rect = { x: number; y: number; width: number; height: number };
/** Keep the coach below half the usable screen, including at large text sizes. */
export function guidePanelLimits(viewport: { width: number; height: number; top: number; bottom: number }) {
  return { width: Math.min(320, Math.max(0, viewport.width - 24)), maxHeight: Math.max(0, Math.min(300, Math.floor((viewport.height - viewport.top - viewport.bottom - 24) * 0.44))) };
}
/** Prefer a clear side of the anchor; a large section focuses on its heading. */
export function coachPlacement(target: Rect, viewport: { width: number; height: number; top: number; bottom: number }, cardHeight: number) {
  const { width, height, top, bottom } = viewport;
  const edge = 12, gap = 12, pad = 4;
  const limits = guidePanelLimits(viewport), panelHeight = Math.min(cardHeight, limits.maxHeight);
  const x = Math.max(8, target.x - pad), y = Math.max(top + 4, target.y - pad);
  const right = Math.min(width - 8, target.x + target.width + pad), end = Math.min(height - bottom - 4, target.y + target.height + pad);
  const spot = { x, y, width: Math.max(0, right - x), height: Math.max(0, end - y) };
  const left = Math.max(edge, Math.min(width - limits.width - edge, x + spot.width / 2 - limits.width / 2));
  const safeEnd = height - bottom - edge;
  const result = (side: "above" | "below" | "left" | "right" | "sheet", px: number, py: number) => ({ spot, side, left: px, top: py, width: limits.width });
  const fullyVisible = target.y >= top && target.y + target.height <= height - bottom && target.x >= 0 && target.x + target.width <= width;
  if (fullyVisible && spot.height > 0 && spot.width > 0) {
    if (y + spot.height + gap + panelHeight <= safeEnd) return result("below", left, y + spot.height + gap);
    if (y - gap - panelHeight >= top + edge) return result("above", left, y - gap - panelHeight);
    const py = Math.max(top + edge, Math.min(safeEnd - panelHeight, y + spot.height / 2 - panelHeight / 2));
    if (x - gap - limits.width >= edge) return result("left", x - gap - limits.width, py);
    if (x + spot.width + gap + limits.width <= width - edge) return result("right", x + spot.width + gap, py);
    if (spot.height > 80) {
      spot.height = 64;
      if (y + spot.height + gap + panelHeight <= safeEnd) return result("below", left, y + spot.height + gap);
    }
  }
  // Unavoidable clipping uses the same compact card, never a full-height sheet.
  const topDock = top + edge, bottomDock = Math.max(topDock, safeEnd - panelHeight);
  const py = Math.abs(y - topDock) > Math.abs(y - bottomDock) ? topDock : bottomDock;
  return result("sheet", Math.max(edge, (width - limits.width) / 2), py);
}
