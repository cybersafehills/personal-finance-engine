import { badgeText, inboxAccessibilityLabel, inboxBadgeCount } from "../badge";

describe("inbox badge", () => {
  it("adds one attention row when the review queue is not empty", () => {
    expect(inboxBadgeCount(1, 5)).toBe(2);
    expect(inboxBadgeCount(0, 0)).toBe(0);
    expect(inboxBadgeCount(3, 0)).toBe(3);
  });

  it("never goes negative or NaN", () => {
    expect(inboxBadgeCount(-4, 0)).toBe(0);
    expect(inboxBadgeCount(Number.NaN, 2)).toBe(1);
  });

  it("caps the text at 99+ and hides at zero", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });

  it("labels the button like the web", () => {
    expect(inboxAccessibilityLabel(0)).toBe("Inbox");
    expect(inboxAccessibilityLabel(1)).toBe("Inbox, 1 item need your attention");
    expect(inboxAccessibilityLabel(2)).toBe("Inbox, 2 items need your attention");
  });
});
