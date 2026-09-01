import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "../../../../lib/cron-auth";
import {
  assessOperationalHealth,
  type OperationalHealthSnapshot,
} from "../../../../lib/operational-health";
import { supabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requestedWindow = Number(
    new URL(request.url).searchParams.get("window_minutes"),
  );
  const windowMinutes = Math.min(
    10080,
    Math.max(5, Number.isFinite(requestedWindow) ? requestedWindow : 60),
  );
  const { data, error } = await supabaseServer().rpc(
    "get_operational_health_snapshot",
    { p_window_minutes: Math.trunc(windowMinutes) },
  );

  if (error || !data) {
    console.error(
      "operational-health route: snapshot failed",
      error?.message ?? "empty snapshot",
    );
    return NextResponse.json({ error: "snapshot_failed" }, { status: 500 });
  }

  const snapshot = data as OperationalHealthSnapshot;
  const assessment = assessOperationalHealth(snapshot);
  return NextResponse.json(
    { assessment, snapshot },
    { status: assessment.overall === "critical" ? 503 : 200 },
  );
}
