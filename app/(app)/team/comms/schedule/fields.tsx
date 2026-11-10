"use client";

// The small controls the board's popups share (round 2026-11-10): the channel
// and the format of a post as buttons – every choice in view, each channel in
// its colour and with its icon – instead of two unlabelled dropdowns.
import type { Ref } from "react";
import { Camera, Megaphone, Send, type LucideIcon } from "lucide-react";
import { FORMAT_LABEL, POST_FORMATS, type PostFormat } from "@/lib/publishing";
import { cn } from "@/lib/utils";
import type { BoardChannel } from "./boardModel";

const CHANNEL_ICON: Record<string, LucideIcon> = { telegram: Send, instagram: Camera };
export const channelIcon = (key: string): LucideIcon => CHANNEL_ICON[key] ?? Megaphone;

/** A channel's colours – the same hues as its markers on the board. */
const CHANNEL_TINT: Record<string, { on: string; tile: string }> = {
  telegram: { on: "border-sky-500 bg-sky-50 text-sky-900", tile: "bg-sky-100 text-sky-700" },
  instagram: { on: "border-pink-500 bg-pink-50 text-pink-900", tile: "bg-pink-100 text-pink-700" },
};
const tintOf = (key: string) => CHANNEL_TINT[key] ?? { on: "border-esn bg-esn/5 text-esn-dark", tile: "bg-gray-100 text-gray-700" };

/** A channel as a square icon tile (a dialog's header, a list). */
export function ChannelTile({ channel, className }: { channel: string; className?: string }) {
  const Icon = CHANNEL_ICON[channel] ?? Megaphone;
  return (
    <span aria-hidden="true" className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tintOf(channel).tile, className)}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** The small caption above a control. */
export function FieldLabel({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) {
  const cls = cn("block text-[11px] font-semibold uppercase tracking-wide text-gray-500", className);
  return htmlFor ? (
    <label htmlFor={htmlFor} className={cls}>
      {children}
    </label>
  ) : (
    <span className={cls}>{children}</span>
  );
}

const SEGMENT = "inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-esn disabled:cursor-not-allowed disabled:opacity-50";
const SEGMENT_OFF = "border-gray-200 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900";

/** Which channel a post goes out on: one button per channel. */
export function ChannelPicker({
  channels,
  value,
  onChange,
  label,
  disabled,
  firstRef,
}: {
  channels: BoardChannel[];
  value: string;
  onChange: (key: string) => void;
  /** For screen readers, e.g. "Channel for Pub Quiz". */
  label: string;
  disabled?: boolean;
  firstRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <span role="group" aria-label={label} className="flex min-w-0 gap-1.5">
      {channels.map((c, i) => {
        const Icon = CHANNEL_ICON[c.key] ?? Megaphone;
        const on = value === c.key;
        return (
          <button key={c.key} ref={i === 0 ? firstRef : undefined} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(c.key)} className={cn(SEGMENT, on ? tintOf(c.key).on : SEGMENT_OFF)} data-channel={c.key}>
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{c.name}</span>
          </button>
        );
      })}
    </span>
  );
}

/** Post, story or reel. With `optional`, the chosen one can be taken off again ("not decided yet"). */
export function FormatPicker({
  value,
  onChange,
  label,
  disabled,
  optional = true,
  formats = POST_FORMATS,
}: {
  value: PostFormat | "";
  onChange: (format: PostFormat | "") => void;
  label: string;
  disabled?: boolean;
  optional?: boolean;
  formats?: readonly PostFormat[];
}) {
  return (
    <span role="group" aria-label={label} className="flex min-w-0 gap-1.5">
      {formats.map((f) => {
        const on = value === f;
        return (
          <button key={f} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(on && optional ? "" : f)} className={cn(SEGMENT, on ? "border-esn bg-esn/5 text-esn-dark" : SEGMENT_OFF)}>
            {/* The shape the post has on the board. */}
            <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 border border-current", f === "story" ? "rounded-full" : "rounded-[2px]", f === "reel" && "ring-1 ring-current ring-offset-1")} />
            {FORMAT_LABEL[f]}
          </button>
        );
      })}
    </span>
  );
}
