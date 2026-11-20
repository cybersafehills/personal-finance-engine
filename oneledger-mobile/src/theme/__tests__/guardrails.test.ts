import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// The theme only works if nobody reaches around it. These checks keep it that way.

const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "test" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const app = files(SRC).filter((f) => !f.includes(`${join(SRC, "theme")}/`));

describe("theme guardrails", () => {
  it("no screen or component imports a palette directly (they use useTheme / makeStyles)", () => {
    const offenders = app.filter((f) => /from "@\/theme\/colors"/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([]);
  });

  it("tokens.ts no longer exports a static colour object", () => {
    expect(readFileSync(join(SRC, "theme", "tokens.ts"), "utf8")).not.toMatch(/export const colors\b/);
  });

  it("nothing hard-codes a hex colour (the QR code and brand scrims are the documented exceptions)", () => {
    const allowed = ["components/ds/QrCode.tsx"];
    const offenders = app.filter((f) => !allowed.some((a) => f.endsWith(a)) && /#[0-9a-fA-F]{6}\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([]);
  });
});
