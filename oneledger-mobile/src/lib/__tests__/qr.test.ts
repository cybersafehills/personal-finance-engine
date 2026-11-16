import { qrMatrix } from "../qr";

const URL = `https://oneledger.me/r/${"ab".repeat(32)}`;

describe("qrMatrix", () => {
  it("is a square grid of booleans with the three finder patterns", () => {
    const m = qrMatrix(URL);
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    const n = m.length;
    // finder squares: dark 7x7 ring corners in three corners, not in the fourth
    for (const [y, x] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[y][x]).toBe(true);
      expect(m[y + 6][x + 6]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
      expect(m[y + 3][x + 3]).toBe(true);
    }
  });
  it("is deterministic and differs for a different link", () => {
    expect(qrMatrix(URL)).toEqual(qrMatrix(URL));
    expect(qrMatrix(URL)).not.toEqual(qrMatrix(URL.replace("ab", "cd")));
  });
});
