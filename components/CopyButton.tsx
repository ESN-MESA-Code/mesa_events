"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** Copies a text (e.g. a list of addresses) and says so. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  return (
    <span className="mt-2 inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {label}
      </Button>
      <span role="status" className="text-xs text-gray-600">
        {state === "copied" ? "Copied." : state === "failed" ? "Could not copy – select the names above instead." : ""}
      </span>
    </span>
  );
}
