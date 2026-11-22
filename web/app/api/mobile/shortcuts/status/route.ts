import { NextRequest } from "next/server";
import { mobileGet, mobileOptions, MobileApiError } from "@/lib/mobile-request";
import { supabaseSession } from "@/lib/supabase-session-server";
import { supabaseServer } from "@/lib/supabase-server";
export const OPTIONS = mobileOptions;
export function GET(request: NextRequest) {
  return mobileGet(request, "shortcut-status", async () => {
    const id = request.nextUrl.searchParams.get("device_id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new MobileApiError(400,"invalid_request","Choose a connected iPhone.");
    // Establish ownership with the user's RLS client BEFORE reading the
    // service-only audit. Never expose credentials, message content or other devices.
    const db = await supabaseSession();
    const {data: device, error} = await db.from("device_credentials").select("id").eq("id",id).maybeSingle();
    if (error || !device) throw new MobileApiError(404,"not_found","Connection unavailable.");
    const {data: events,error: auditError} = await supabaseServer().from("connector_pairing_events")
      .select("event,reason_code,created_at").eq("device_credential_id",device.id)
      .in("event",["device_test_succeeded","capture_accepted","capture_rejected"])
      .order("created_at",{ascending:false}).limit(30);
    if (auditError) throw new Error("Could not read connection status");
    return {testAt:events?.find(e=>e.event==="device_test_succeeded")?.created_at??null,
      captureAt:events?.find(e=>e.event==="capture_accepted")?.created_at??null,
      rejection:events?.find(e=>e.event==="capture_rejected")??null};
  });
}
