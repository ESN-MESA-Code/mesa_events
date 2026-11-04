// The section's coloured pretzel followed by "ESN MESA": an SVG and text
// instead of the full section logo, whose small type was unreadable at header
// size. Figtree (the closest free match to the logo's "ESN", self-hosted: no
// request to Google) at the logo's letter height, ExtraBold "ESN" and Regular
// "MESA" so the lettering has a hierarchy without competing with the pretzel's
// colours. Other options: design/README.md.
import Image from "next/image";
import { cn } from "@/lib/utils";
import { figtree } from "@/components/fonts";

/** Pretzel + "ESN MESA" (+ an optional product name after a divider). */
export function BrandMark({ product, tone = "light", size = "md", className }: { product?: string; tone?: "light" | "dark"; size?: "md" | "lg"; className?: string }) {
  const light = tone === "light";
  return (
    <span className={cn("inline-flex items-center", size === "lg" ? "gap-3.5" : "gap-2.5 sm:gap-3", className)}>
      {/* All four colours stay clear of the dark blue header: no backing needed. */}
      <Image
        src="/pretzel.svg"
        alt=""
        width={2200}
        height={1823}
        loading="eager"
        className={cn("shrink-0 w-auto", size === "lg" ? "h-[60px]" : "h-9 sm:h-10")}
      />
      <span
        className={cn(
          figtree.className,
          // Trim the line box to the capitals so they sit on the pretzel's centre.
          "tracking-[0.03em] leading-none whitespace-nowrap [text-box:trim-both_cap_alphabetic]",
          size === "lg" ? "text-[40px]" : "text-[26px] sm:text-[28px]",
          light ? "text-white" : "text-esn"
        )}
      >
        <span className="font-extrabold">ESN</span> <span className={cn("font-normal", light && "text-white/90")}>MESA</span>
      </span>
      {product && (
        <span
          className={cn(
            "font-medium leading-none whitespace-nowrap border-l pl-3 ml-0.5 py-0.5 self-center",
            // In the header only where the navigation leaves room for it.
            size === "lg" ? "text-xl" : "hidden xl:inline text-lg",
            light ? "text-white/75 border-white/30" : "text-gray-500 border-gray-300"
          )}
        >
          {product}
        </span>
      )}
    </span>
  );
}
