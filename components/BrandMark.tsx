// The ESN star followed by "ESN MESA": drawn as SVG and text instead of the
// full section logo, whose small type was unreadable at header size. The
// lettering matches the logo's "ESN" (Figtree 600 is the closest free
// match, self-hosted: no request to Google) at the same letter height.
import localFont from "next/font/local";
import { cn } from "@/lib/utils";

const wordmark = localFont({ src: "./fonts/figtree-600-latin.woff2", weight: "600", display: "swap" });

// Clockwise from the top, as in the ESN star.
const ARMS = ["#7AC143", "#EC008C", "#F47920", "#7AC143", "#00AEEF", "#F47920", "#EC008C", "#00AEEF"];

export function EsnStar({ className }: { className?: string }) {
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true" className={cn("shrink-0", className)}>
      {ARMS.map((color, i) => (
        <rect key={i} x="-6.5" y="-48" width="13" height="37" rx="3.5" fill={color} transform={`rotate(${i * 45})`} />
      ))}
    </svg>
  );
}

/** Star + "ESN MESA" (+ an optional product name after a divider). */
export function BrandMark({ product, tone = "light", size = "md", className }: { product?: string; tone?: "light" | "dark"; size?: "md" | "lg"; className?: string }) {
  const light = tone === "light";
  return (
    <span className={cn("inline-flex items-center", size === "lg" ? "gap-3" : "gap-2.5", className)}>
      <EsnStar className={size === "lg" ? "h-14 w-14" : "h-9 w-9"} />
      <span
        className={cn(
          wordmark.className,
          "tracking-[0.04em] leading-none whitespace-nowrap",
          size === "lg" ? "text-[40px]" : "text-[28px]",
          light ? "text-white" : "text-esn"
        )}
      >
        ESN MESA
      </span>
      {product && (
        <span
          className={cn(
            "font-medium leading-none whitespace-nowrap border-l pl-2.5 self-center",
            size === "lg" ? "text-xl" : "hidden md:inline text-lg",
            light ? "text-white/75 border-white/30" : "text-gray-500 border-gray-300"
          )}
        >
          {product}
        </span>
      )}
    </span>
  );
}
