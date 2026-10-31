"use client";

// Two language versions of one legal text (usability review #15): one shown
// at a time, both in the page (and both legally binding as before).
import { useState } from "react";
import { cn } from "@/lib/utils";

export function LangTabs({ versions }: { versions: Array<{ lang: string; label: string; html: string }> }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" aria-label="Language" className="mb-4 inline-flex rounded-md border border-gray-300 text-sm">
        {versions.map((v, i) => (
          <button
            key={v.lang}
            type="button"
            role="tab"
            id={`tab-${v.lang}`}
            aria-selected={i === active}
            aria-controls={`panel-${v.lang}`}
            onClick={() => setActive(i)}
            className={cn("px-3 py-1.5 first:rounded-l-md last:rounded-r-md", i === active ? "bg-esn text-white" : "text-gray-700 hover:bg-gray-50")}
          >
            {v.label}
          </button>
        ))}
      </div>
      {versions.map((v, i) => (
        <div key={v.lang} id={`panel-${v.lang}`} role="tabpanel" aria-labelledby={`tab-${v.lang}`} lang={v.lang} hidden={i !== active} className="legal-prose" dangerouslySetInnerHTML={{ __html: v.html }} />
      ))}
    </div>
  );
}
