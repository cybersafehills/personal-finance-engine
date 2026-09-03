import { assertEquals } from "jsr:@std/assert@1";
import {
  ACCOUNTANT_PACKAGE_FORMATS,
  ACCOUNTANT_PACKAGE_STATUSES,
  type AccountantPackage,
  isAccountantPackageDownloadable,
  isAccountantPackageFinished,
} from "./model.ts";

Deno.test("status + format vocabularies are the documented sets", () => {
  assertEquals(ACCOUNTANT_PACKAGE_STATUSES, [
    "queued",
    "building",
    "ready",
    "failed",
  ]);
  assertEquals(ACCOUNTANT_PACKAGE_FORMATS, ["csv", "xlsx", "pdf"]);
});

Deno.test("isAccountantPackageFinished only for terminal states", () => {
  assertEquals(isAccountantPackageFinished("ready"), true);
  assertEquals(isAccountantPackageFinished("failed"), true);
  assertEquals(isAccountantPackageFinished("queued"), false);
  assertEquals(isAccountantPackageFinished("building"), false);
});

Deno.test("isAccountantPackageDownloadable requires ready + a storage path", () => {
  const base: Pick<AccountantPackage, "status" | "storagePath"> = {
    status: "ready",
    storagePath: "ws/pkg/oneledger-accountant-package.zip",
  };
  assertEquals(isAccountantPackageDownloadable(base), true);
  assertEquals(
    isAccountantPackageDownloadable({ ...base, storagePath: null }),
    false,
  );
  assertEquals(
    isAccountantPackageDownloadable({ ...base, status: "building" }),
    false,
  );
});
