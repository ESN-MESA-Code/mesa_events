import { getViewer } from "@/lib/supabase/session";
import { createSessionClient } from "@/lib/supabase/session";
import { hasRole } from "@/lib/roles";
import { loadYear } from "@/lib/financeYear";
import { bySphere, SPHERE_LABELS } from "@/lib/financeReport";
import { centsDe, toCsv } from "@/lib/payments/csv";

// CSV downloads for the tax return and the tax adviser (round 2026-11-11):
// the journal (every line of the year), the EÜR by sphere and category,
// the imported PayPal payments, the per-event results. Semicolons and
// decimal commas, so German Excel opens them as they are. Finance and
// executives; RLS limits what is read.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !(hasRole(viewer.roles, "finance") || viewer.roles.includes("executive"))) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const kind = url.searchParams.get("kind");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Which year?", { status: 400 });
  const db = await createSessionClient();
  let rows: Array<Array<string | number>>;

  if (kind === "journal" || kind === "euer" || kind === "events") {
    const lines = await loadYear(db, year);
    if (kind === "journal") {
      rows = [
        ["Datum", "Belegnr.", "Text", "Kategorie", "Sphäre", "Veranstaltung", "Einnahme", "Ausgabe", "Zahlungsweg", "Gegenpartei", "Beleg vorhanden", "Quelle", "Notiz"],
        ...lines.map((l) => [
          l.day,
          l.receiptRef,
          l.description,
          l.category,
          SPHERE_LABELS[l.sphere].de,
          l.event,
          l.direction === "income" ? centsDe(l.cents) : "",
          l.direction === "expense" ? centsDe(l.cents) : "",
          l.method,
          l.counterparty,
          l.receiptFiled ? "ja" : "nein",
          l.source,
          l.note,
        ]),
      ];
    } else if (kind === "euer") {
      const spheres = bySphere(lines.map((l) => ({ direction: l.direction, amount_cents: l.cents, booked_on: l.day, category_id: l.category, sphere: l.sphere })));
      rows = [["Sphäre", "Kategorie", "Einnahmen", "Ausgaben", "Ergebnis"]];
      for (const s of spheres) {
        const cats = new Map<string, { in: number; out: number }>();
        for (const l of lines.filter((x) => x.sphere === s.sphere)) {
          const c = cats.get(l.category) ?? { in: 0, out: 0 };
          if (l.direction === "income") c.in += l.cents;
          else c.out += l.cents;
          cats.set(l.category, c);
        }
        for (const [name, c] of [...cats.entries()].sort()) rows.push([SPHERE_LABELS[s.sphere].de, name, centsDe(c.in), centsDe(c.out), centsDe(c.in - c.out)]);
        rows.push([SPHERE_LABELS[s.sphere].de, "Summe", centsDe(s.income), centsDe(s.expenses), centsDe(s.result)]);
      }
      const all = spheres.reduce((a, s) => ({ i: a.i + s.income, e: a.e + s.expenses }), { i: 0, e: 0 });
      rows.push(["Gesamt", "", centsDe(all.i), centsDe(all.e), centsDe(all.i - all.e)]);
    } else {
      const per = new Map<string, { in: number; out: number; n: number }>();
      for (const l of lines.filter((x) => x.event)) {
        const r = per.get(l.event) ?? { in: 0, out: 0, n: 0 };
        if (l.direction === "income") r.in += l.cents;
        else r.out += l.cents;
        r.n++;
        per.set(l.event, r);
      }
      rows = [["Veranstaltung", "Einnahmen", "Ausgaben inkl. Erstattungen", "Ergebnis", "Buchungen"], ...[...per.entries()].map(([e, r]) => [e, centsDe(r.in), centsDe(r.out), centsDe(r.in - r.out), r.n])];
    }
  } else if (kind === "paypal") {
    const { data, error } = await db
      .from("payments")
      .select("booked_on, external_id, type, name, email, gross_cents, fee_cents, subject, note, status, matched_by, ignore_reason, payment_links:link_id(reference)")
      .gte("booked_on", `${year}-01-01`)
      .lte("booked_on", `${year}-12-31`)
      .order("booked_on")
      .limit(20000);
    if (error) return new Response(error.message, { status: 500 });
    rows = [
      ["Datum", "Transaktionscode", "Typ", "Name", "E-Mail", "Brutto", "Gebühr", "Netto", "Betreff", "Mitteilung", "Status", "Zugeordnet durch", "Referenz", "Ignoriert weil"],
      ...(data ?? []).map((p) => [
        p.booked_on,
        p.external_id,
        p.type,
        p.name,
        p.email,
        centsDe(p.gross_cents),
        centsDe(p.fee_cents),
        centsDe(p.gross_cents + p.fee_cents),
        p.subject,
        p.note,
        p.status === "booked" ? "gebucht" : p.status === "ignored" ? "ignoriert" : "offen",
        p.matched_by ?? "",
        (p.payment_links as { reference: string } | null)?.reference ?? "",
        p.ignore_reason,
      ]),
    ];
  } else return new Response("Which export?", { status: 400 });

  const name = { journal: "Journal", euer: "EUER", paypal: "PayPal", events: "Veranstaltungen" }[kind];
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="MESA-${name}-${year}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
