import { supabaseAdmin } from "@/lib/supabase/admin";
import { linkEsnEvent, preflight } from "@/lib/esn/api";

// The browser script links the saved ESN activity back to the event
// (personal access token; lib/esn/api.ts).
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await linkEsnEvent(request, (await params).id, supabaseAdmin());
  } catch (err) {
    console.error("ESN API failed:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
