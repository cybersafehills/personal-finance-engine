import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Pushed screens get a native navigation header (back arrow + title) from the
// (app) Stack; drawing a "Back" button in the body again would show two. Tab
// screens and the sheets/modals are the only places without that header.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

const APP = join(__dirname, "..", "app", "(app)");
const FEATURES = join(__dirname, "..", "features");
const HAND_DRAWN_BACK = /<Button\s+label="(Back|Cancel)"[^>]*onPress=\{\(\) => router\.back\(\)\}/;

describe("navigation chrome", () => {
  it("no screen draws its own Back button (the native header has the arrow)", () => {
    const offenders = [...files(APP), ...files(FEATURES)].filter((f) => HAND_DRAWN_BACK.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(APP, "(app)").replace(FEATURES, "features"))).toEqual([]);
  });

  it("the (app) stack turns the native header on for pushed screens and off for tabs, sheets and modals", () => {
    const layout = readFileSync(join(APP, "_layout.tsx"), "utf8");
    expect(layout).toMatch(/headerShown: true/);
    expect(layout).toMatch(/name="\(tabs\)" options=\{\{ headerShown: false \}\}/);
    expect(layout).toMatch(/name="pay-sheet"[\s\S]*headerShown: false/);
    expect(layout).toMatch(/name="connect" options=\{\{ presentation: "modal", headerShown: false \}\}/);
  });

  it("tab screens draw their own title in the body", () => {
    for (const name of ["more", "inbox", "transactions"]) {
      const src = readFileSync(join(APP, "(tabs)", `${name}.tsx`), "utf8");
      expect(src).toMatch(/<ScreenHeader[\s\S]*?inline/);
    }
  });
});
