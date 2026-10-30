import { getViewer } from "@/lib/supabase/session";
import { searchAddresses, verifyAddress } from "@/lib/geocode";
import { validateAddress } from "@/lib/address";

// Address suggestions and checks for the address fields (lib/geocode.ts),
// for signed-in members only. The lookup runs here, so members' browsers
// never talk to the lookup service.
//   GET ?q=…                                        → { suggestions }
//   GET ?country=DE&street=…&postal=…&city=…        → { verification }
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = new URL(request.url).searchParams;
  const q = p.get("q");
  if (q !== null) return Response.json({ suggestions: await searchAddresses(q) }, { headers: { "Cache-Control": "private, max-age=300" } });
  const address = { country: p.get("country") ?? "DE", street: p.get("street") ?? "", postalCode: p.get("postal") ?? "", city: p.get("city") ?? "" };
  if (Object.keys(validateAddress(address)).length) return Response.json({ verification: "not_found" });
  return Response.json({ verification: await verifyAddress(address) });
}
