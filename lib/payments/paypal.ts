// PayPal activity downloads (round 2026-11-11): "Activity → Statements →
// Activity download → Completed payments → CSV" in English or German. One
// row per transaction; only completed ones in euro are imported (pending
// ones come again, completed, in a later download). Pure
// (tests/unit/payments.test.ts).
import { column, detectDateOrder, parseAmount, parseCsv, parseDate, parseTime, type DateOrder } from "./csv";

/** One PayPal transaction as the import sends it to the server. */
export interface PaypalRow {
  /** Transaction ID (Transaktionscode). */
  id: string;
  /** "2026-11-11" */
  day: string;
  /** "14:05" (the account's time zone – Berlin for MESA). */
  time: string;
  type: string;
  name: string;
  /** The other side's email (sender of incoming money, recipient of outgoing). */
  email: string;
  gross: number;
  fee: number;
  /** PayPal balance after this transaction (null when the export has no balance column). */
  balance: number | null;
  subject: string;
  note: string;
  invoice: string;
  referenceTxn: string;
}

export interface PaypalParse {
  rows: PaypalRow[];
  /** Rows left out, with why (pending, another currency, …). */
  skipped: Array<{ line: number; reason: string }>;
  dateOrder: DateOrder;
  from: string | null;
  to: string | null;
  /** The balance after the latest transaction (and its day). */
  balance: { cents: number; day: string } | null;
  /** Columns PayPal must have that the file lacks (the wrong report was downloaded). */
  missing: string[];
}

const H = {
  date: ["date", "datum"],
  time: ["time", "uhrzeit"],
  name: ["name"],
  type: ["type", "typ", "beschreibung", "description"],
  status: ["status"],
  currency: ["currency", "währung", "waehrung"],
  gross: ["gross", "brutto"],
  fee: ["fee", "fees", "gebühr", "gebühren", "entgelt"],
  from: ["from email address", "absender e-mail-adresse", "von e-mail-adresse", "absender-e-mail-adresse"],
  to: ["to email address", "empfänger e-mail-adresse", "an e-mail-adresse", "empfänger-e-mail-adresse"],
  id: ["transaction id", "transaktionscode", "transaktions-id"],
  subject: ["subject", "betreff"],
  note: ["note", "hinweis", "mitteilung", "nachricht"],
  item: ["item title", "artikelbezeichnung"],
  invoice: ["invoice number", "rechnungsnummer"],
  ref: ["reference txn id", "zugehöriger transaktionscode", "referenztransaktionscode"],
  balance: ["balance", "guthaben", "saldo"],
} as const;

const COMPLETED = /^(completed|abgeschlossen|fertig|erledigt|success|succeeded)$/i;

/** Parses a PayPal activity download. `order` overrides the detected day/month order. */
export function parsePaypalCsv(text: string, order?: DateOrder): PaypalParse {
  const table = parseCsv(text);
  const headerAt = table.findIndex((r) => column(r, H.id) >= 0 && column(r, H.gross) >= 0);
  const header = headerAt >= 0 ? table[headerAt] : (table[0] ?? []);
  const col = Object.fromEntries(Object.entries(H).map(([k, aliases]) => [k, column(header, aliases)])) as Record<keyof typeof H, number>;
  const missing = (["date", "gross", "id"] as const).filter((k) => col[k] < 0).map((k) => H[k][0]);
  const empty: PaypalParse = { rows: [], skipped: [], dateOrder: order ?? "dmy", from: null, to: null, balance: null, missing };
  if (missing.length) return empty;
  const body = table.slice(headerAt + 1);
  const cell = (r: string[], k: keyof typeof H) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
  const dateOrder = order ?? detectDateOrder(body.map((r) => cell(r, "date")));

  const rows: PaypalRow[] = [];
  const skipped: PaypalParse["skipped"] = [];
  const seen = new Set<string>();
  let balance: PaypalParse["balance"] = null;
  let balanceAt = "";
  body.forEach((r, i) => {
    const line = headerAt + i + 2;
    const id = cell(r, "id");
    const day = parseDate(cell(r, "date"), dateOrder);
    const gross = parseAmount(cell(r, "gross"));
    const status = cell(r, "status");
    const currency = (cell(r, "currency") || "EUR").toUpperCase();
    if (!id) return skipped.push({ line, reason: "no transaction ID" });
    if (!day) return skipped.push({ line, reason: `no date (“${cell(r, "date")}”)` });
    if (gross === null) return skipped.push({ line, reason: `no amount (“${cell(r, "gross")}”)` });
    if (status && !COMPLETED.test(status)) return skipped.push({ line, reason: `status “${status}”` });
    if (currency !== "EUR") return skipped.push({ line, reason: `in ${currency}` });
    if (gross === 0) return skipped.push({ line, reason: "amount 0" });
    if (seen.has(id)) return skipped.push({ line, reason: "listed twice" });
    seen.add(id);
    const incoming = gross > 0;
    const bal = parseAmount(cell(r, "balance"));
    const time = parseTime(cell(r, "time"));
    const row: PaypalRow = {
      id: id.slice(0, 60),
      day,
      time,
      type: cell(r, "type").slice(0, 120),
      name: cell(r, "name").slice(0, 200),
      email: (incoming ? cell(r, "from") : cell(r, "to")).slice(0, 200),
      gross,
      fee: parseAmount(cell(r, "fee")) ?? 0,
      balance: bal,
      subject: (cell(r, "subject") || cell(r, "item")).slice(0, 500),
      note: cell(r, "note").slice(0, 1000),
      invoice: cell(r, "invoice").slice(0, 200),
      referenceTxn: cell(r, "ref").slice(0, 60),
    };
    rows.push(row);
    // The latest transaction's balance (exports list newest or oldest first; same minute: the later line).
    if (bal !== null && `${day} ${time}` >= balanceAt) {
      balance = { cents: bal, day };
      balanceAt = `${day} ${time}`;
    }
  });
  const days = rows.map((r) => r.day).sort();
  return { rows, skipped, dateOrder, from: days[0] ?? null, to: days[days.length - 1] ?? null, balance, missing };
}

/**
 * Movements between MESA's own accounts and PayPal's bookkeeping lines
 * (withdrawals to the bank, bank top-ups, holds and their release,
 * authorisations): not income or spending, ignored on import.
 */
export function isTransfer(type: string): boolean {
  return /withdrawal|abbuchung|bank deposit|bankgutschrift|aufladung|hold|einbehalt|reserve|authori[sz]ation|autorisierung|reversal of general|rückbuchung allgemeine|payment review|zahlungsprüfung/i.test(type);
}
