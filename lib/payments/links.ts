// PayPal.me links with a reference (round 2026-11-11). A link is
// paypal.me/<name>/<amount>EUR; PayPal cannot carry a note in the link, so
// the payer types the reference (MESA-K7Q2P) into the note – the sign and
// the QR card say so. Pure (tests/unit/payments.test.ts).

/** Letters and digits that cannot be mixed up (no 0/O, 1/I). */
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A fresh reference: "MESA-" and five characters (32^5 ≈ 33 million). */
export function newReference(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(5);
  return `MESA-${[...bytes].map((b) => REFERENCE_ALPHABET[b % 32]).join("")}`;
}

/** "€ 5.50" → "5.50", 500 → "5" (the PayPal.me amount, dot decimals). */
export function paypalAmount(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** https://paypal.me/<name>/5.50EUR (or without an amount: the payer enters it). */
export function paypalMeUrl(handle: string, cents: number | null): string {
  const base = `https://paypal.me/${encodeURIComponent(handle)}`;
  return cents ? `${base}/${paypalAmount(cents)}EUR` : base;
}

/**
 * The references a payment's texts mention: "MESA-K7Q2P", "mesa k7q2p",
 * "MESAK7Q2P", and a known code on its own ("K7Q2P") – people drop the
 * prefix. Only references that exist count.
 */
export function findReferences(texts: string[], known: ReadonlySet<string>): string[] {
  const text = texts.join(" \n ").toUpperCase();
  const found = new Set<string>();
  for (const m of text.matchAll(/MESA[\s\-_.:#/]*([2-9A-HJ-NP-Z]{5})(?![A-Z0-9])/g)) {
    const ref = `MESA-${m[1]}`;
    if (known.has(ref)) found.add(ref);
  }
  if (!found.size) {
    for (const m of text.matchAll(/(?<![A-Z0-9])([2-9A-HJ-NP-Z]{5})(?![A-Z0-9])/g)) {
      const ref = `MESA-${m[1]}`;
      if (known.has(ref)) found.add(ref);
    }
  }
  return [...found];
}

/** What the payer reads under the QR code. */
export function payInstruction(reference: string): string {
  return `Write ${reference} in the PayPal note (“Mitteilung”) – that is how we know what you paid for.`;
}
