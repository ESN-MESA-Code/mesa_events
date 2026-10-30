import { getViewer } from "@/lib/supabase/session";
import { hasRole } from "@/lib/roles";
import { appBaseUrl } from "@/lib/env";
import { userscript } from "@/lib/esn/script";

// The browser script for this platform (no token inside), for the executive board.
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !hasRole(viewer.roles, "executive")) return new Response("Not found", { status: 404 });
  return new Response(userscript(appBaseUrl()), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}
