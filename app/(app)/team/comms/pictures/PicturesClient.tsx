"use client";

import { useState } from "react";
import { ImageIcon, Layers, Search, Shapes } from "lucide-react";
import { Input } from "@/components/ui";
import { Panel } from "@/components/Panel";
import { useAction } from "@/components/ActionButton";
import { PictureButton, UploadedPicture, pictureProblem } from "@/components/PostPicture";
import { setDefaultPicture } from "@/app/actions/publishing";
import { supabase } from "@/lib/supabase/client";

export interface PictureSlot {
  key: string;
  formatId?: string;
  eventType?: "standard" | "special" | "day_trip" | "weekend_trip";
  name: string;
  note: string;
  /** "library:<path>" in advertising-pictures, null when none. */
  picture: string | null;
}

/** One default: its picture, a button to choose or replace it, and remove. */
function Slot({ slot, editable }: { slot: PictureSlot; editable: boolean }) {
  const { run, pending, error, setError, confirm } = useAction();
  const [uploading, setUploading] = useState(false);
  const target = slot.formatId ? { format_id: slot.formatId } : { event_type: slot.eventType };

  async function upload(file: File) {
    setError(null);
    const problem = pictureProblem(file);
    if (problem) return setError(problem);
    setUploading(true);
    const folder = slot.formatId ? `format/${slot.formatId}` : `type/${slot.eventType}`;
    const path = `${folder}/${crypto.randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const { error: e } = await supabase.storage.from("advertising-pictures").upload(path, file, { contentType: file.type });
    setUploading(false);
    if (e) return setError(`Upload failed: ${e.message}`);
    run(setDefaultPicture, { ...target, picture: `library:${path}` }, undefined, `Default picture for ${slot.name} saved.`);
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm" data-testid={`picture-${slot.key}`}>
      <div>
        <p className="font-semibold text-gray-900">{slot.name}</p>
        <p className="text-xs text-gray-500">{slot.note}</p>
      </div>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-gray-50">
        {slot.picture ? <UploadedPicture picture={slot.picture} className="max-h-full" /> : <span className="flex flex-col items-center gap-1 text-xs text-gray-400"><ImageIcon className="h-6 w-6" aria-hidden="true" />No default picture</span>}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <PictureButton label={slot.picture ? "Replace the picture" : "Choose a picture"} ariaLabel={slot.picture ? `Replace the picture of ${slot.name}` : `Choose a picture for ${slot.name}`} disabled={uploading || pending} onFile={upload} />
          {slot.picture && (
            <button
              type="button"
              className="text-xs text-gray-600 hover:underline"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: "Remove the default picture?", body: `Posts of ${slot.name} that have no picture of their own go out without one.`, confirmLabel: "Remove", danger: true }))
                  run(setDefaultPicture, { ...target, picture: "" }, undefined, "Default picture removed.");
              }}
            >
              Remove
            </button>
          )}
          {uploading && <span className="text-xs text-gray-500">Uploading…</span>}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

/** The defaults by event type, then by format (searchable: there are many formats). */
export function DefaultPictures({ types, formats, editable }: { types: PictureSlot[]; formats: PictureSlot[]; editable: boolean }) {
  const [query, setQuery] = useState("");
  const shown = formats.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));
  const grid = "grid gap-3 sm:grid-cols-2 lg:grid-cols-4";
  return (
    <div className="space-y-6">
      <Panel title="By event type" icon={Shapes} description="Used when an event has no format picture.">
        <ul className={grid} data-testid="type-pictures">
          {types.map((t) => (
            <Slot key={t.key} slot={t} editable={editable} />
          ))}
        </ul>
      </Panel>
      <Panel
        title="By format (event series)"
        icon={Layers}
        aside={
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
            {formats.filter((f) => f.picture).length} of {formats.length} with a picture
          </span>
        }
      >
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <Input aria-label="Find a format" placeholder="Find a format, e.g. Language Café" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
          </div>
          {!shown.length ? (
            <p className="py-6 text-center text-sm text-gray-500">No format matches.</p>
          ) : (
            <ul className={grid} data-testid="format-pictures">
              {shown.map((f) => (
                <Slot key={f.key} slot={f} editable={editable} />
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
