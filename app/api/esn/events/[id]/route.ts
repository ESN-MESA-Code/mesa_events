import { supabaseAdmin } from "@/lib/supabase/admin";
import { getEsnEvent, preflight } from "@/lib/esn/api";

// The ESN form data of an event, for the Comms member's browser script on
// activities.esn.org (personal access token; lib/esn/api.ts).
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await getEsnEvent(request, (await params).id, supabaseAdmin());
  } catch (err) {
    console.error("ESN API failed:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
