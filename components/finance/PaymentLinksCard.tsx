import Link from "next/link";
import { QrCode } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PaymentLinksPanel, type LinkKind } from "@/components/finance/PaymentLinksPanel";

/**
 * The PayPal QR codes of an event or office hour (round 2026-11-11 (2)):
 * loaded here, shown and made by the people on duty in PaymentLinksPanel.
 * Rendered inside the cash box while it runs, or on its own.
 */
export async function PaymentLinks({
  supabase,
  target,
  canCreate,
  context,
  officeHour,
}: {
  supabase: SupabaseClient<Database>;
  target: { event_id: string } | { internal_event_id: string };
  canCreate: boolean;
  context: string;
  officeHour: boolean;
}) {
  const q = supabase.from("payment_links").select("id, reference, title, amount_cents, active, preset").order("created_at");
  const [{ data: links }, { data: settings }] = await Promise.all([
    "event_id" in target ? q.eq("event_id", target.event_id) : q.eq("internal_event_id", target.internal_event_id),
    supabase.from("app_settings").select("key, value").in("key", ["paypal_me_handle", "paypal_account_name", "esncard_price_internal_cents", "esncard_price_external_cents"]),
  ]);
  const setting = (k: string) => (settings ?? []).find((s) => s.key === k)?.value;
  const text = (k: string) => (typeof setting(k) === "string" ? (setting(k) as string) : "");
  const cents = (k: string) => (typeof setting(k) === "number" ? (setting(k) as number) : null);
  // Office hours: the ESNcard codes are made with the cash box; the OC adds others (drinks …) by hand.
  const kinds: LinkKind[] = officeHour ? ["drinks", "other"] : ["drinks", "ticket", "other"];
  return (
    <PaymentLinksPanel
      links={(links ?? []).map((l) => ({ id: l.id, reference: l.reference, title: l.title, amount: l.amount_cents, active: l.active, preset: l.preset }))}
      automatic={officeHour ? ["esncard_internal", "esncard_external"] : []}
      target={target}
      kinds={kinds}
      prices={{ esncard_internal: cents("esncard_price_internal_cents"), esncard_external: cents("esncard_price_external_cents") }}
      canCreate={canCreate}
      handle={text("paypal_me_handle")}
      accountName={text("paypal_account_name") || "ESN MESA"}
      context={context}
    />
  );
}

/** The same in a card of its own (pages without a running cash box). */
export async function PaymentLinksCard(props: Parameters<typeof PaymentLinks>[0] & { finance: boolean }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" data-testid="payment-links">
      <div className="mb-3 flex items-center gap-2">
        <QrCode className="h-5 w-5 text-esn" aria-hidden="true" />
        <h2 className="mr-auto text-base font-bold text-gray-900">Pay with PayPal</h2>
        {props.finance && (
          <Link href="/team/finance/links" className="text-sm text-esn hover:underline">
            All links →
          </Link>
        )}
      </div>
      <PaymentLinks {...props} />
    </section>
  );
}
