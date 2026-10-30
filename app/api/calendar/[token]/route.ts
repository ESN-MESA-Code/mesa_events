import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseFeedSegment, renderFeed } from "@/lib/calendarFeed";

// A member's calendar subscription (iCal): the secret token in the URL
// stands in for the session calendar apps cannot have (lib/calendarFeed.ts).
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = parseFeedSegment((await params).token);
  if (!token) return NOT_FOUND();
  try {
    const ics = await renderFeed(supabaseAdmin(), token);
    if (ics === null) return NOT_FOUND();
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="esn-mesa.ics"',
        // Personal: never in a shared cache.
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    console.error("Calendar feed failed:", err);
    return new Response("Something went wrong", { status: 500 });
  }
}
