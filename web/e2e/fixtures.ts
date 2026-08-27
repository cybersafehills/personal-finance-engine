import { test as base, expect } from "@playwright/test";

/**
 * Every spec file imports `test`/`expect` from here instead of directly
 * from "@playwright/test", so every test automatically surfaces browser
 * console errors and uncaught page errors as plain stdout lines (GitHub
 * Actions captures raw job stdout regardless of the Playwright reporter
 * in use) - without this, a client-side exception (e.g. a Server Action
 * throwing instead of returning a typed error) is silently swallowed and
 * a failing assertion downstream ("Saved" never appears) gives no clue
 * why.
 */
export const test = base.extend({
  // Named `runWithPage` rather than Playwright's conventional `use` -
  // purely to sidestep eslint-plugin-react-hooks misreading a callback
  // parameter literally named `use` as a React Hook call in this
  // Next.js/React-linted project. Playwright doesn't care what this
  // parameter is called; only its position (second) matters.
  page: async ({ page }, runWithPage) => {
    // Opt every spec out of the branded app-opening screen
    // (components/brand/BrandSplashScreen.tsx) by default: a ~1.2s
    // full-viewport overlay on the first load of each test would race
    // clicks and disturb visual baselines across the whole suite. The
    // splash gets its own dedicated coverage in brand-splash.spec.ts,
    // which clears this cookie to exercise the real thing.
    await page.context().addCookies([
      {
        name: "oneledger_splash_off",
        value: "1",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[browser console.error] ${msg.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      console.log(`[browser pageerror] ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      console.log(
        `[browser requestfailed] ${request.method()} ${request.url()} - ${request.failure()?.errorText}`,
      );
    });
    await runWithPage(page);
  },
});

export { expect };
