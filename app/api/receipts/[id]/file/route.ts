import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSessionClient, getViewer } from "@/lib/supabase/session";

// A receipt's photo for the claimant and Finance: a one-minute signed link.
// Both the claim (RLS) and the Storage object (storage policy) must be
// readable by the signed-in member; anyone else gets 404 (no hint whether
// the claim exists).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const viewer = await getViewer();
  if (!viewer?.accepted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createSessionClient();
  const { data } = await supabase.from("reimbursements").select("receipts(reference_path)").eq("id", id).maybeSingle();
  const path = (data?.receipts as { reference_path: string | null } | null)?.reference_path;
  if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: signed, error } = await supabase.storage.from("receipts").createSignedUrl(path, 60);
  if (error || !signed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
