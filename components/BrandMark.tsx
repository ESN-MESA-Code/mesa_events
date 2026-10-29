// The ESN star followed by "ESN MESA": drawn as SVG and text instead of the
// full section logo, whose small type was unreadable at header size.
import { cn } from "@/lib/utils";

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
      <EsnStar className={size === "lg" ? "h-12 w-12" : "h-8 w-8"} />
      <span className={cn("font-extrabold tracking-tight leading-none whitespace-nowrap", size === "lg" ? "text-3xl" : "text-xl", light ? "text-white" : "text-esn")}>
        ESN MESA
      </span>
      {product && (
        <span
          className={cn(
            "font-medium leading-none whitespace-nowrap border-l pl-2.5",
            size === "lg" ? "text-xl" : "hidden sm:inline text-lg",
            light ? "text-white/75 border-white/30" : "text-gray-500 border-gray-300"
          )}
        >
          {product}
        </span>
      )}
    </span>
  );
}
