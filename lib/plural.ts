// One way to count things in the UI: "1 helper slot", "2 helper slots",
// "1 Beleg", "3 Belege" – never "slot(s)" (review 2026-10-29 B3).

/** "1 event", "2 events"; `many` for irregular plurals ("Belege"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "is" / "are" to go with a count. */
export const isAre = (n: number) => (n === 1 ? "is" : "are");
