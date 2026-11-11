"use client";

// Finance charts (round 2026-11-11), plain SVG and HTML – no chart library.
// One € axis per chart, thin bars with rounded data ends on the baseline, a
// recessive grid, a legend for two series, a hover tooltip on every mark
// and the numbers as a table under "Show as table". Income is blue, spending
// orange (validated pair, see the dataviz checks in the round's notes).
import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/dates";
import { niceScale, shortMonth, type MonthPoint } from "@/lib/financeReport";
import { cn } from "@/lib/utils";

export const INCOME = "#2a78d6";
export const SPENDING = "#eb6834";
const GRID = "#e5e7eb";
const INK_MUTED = "#6b7280";

/** The chart's drawing width = its box's width in pixels, so labels keep their real size in narrow columns. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => el.clientWidth > 0 && setWidth(Math.round(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const euro = (cents: number) => {
  const v = Math.round(cents / 100);
  return Math.abs(v) >= 1000 ? `€${(v / 1000).toLocaleString("en", { maximumFractionDigits: 1 })}k` : `€${v}`;
};

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-gray-600">
      {items.map(([label, color]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** A tooltip at a point of the chart, in % of its width and height. */
function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: `clamp(4.5rem, ${x}%, calc(100% - 4.5rem))`, top: `${y}%`, transform: "translate(-50%, calc(-100% - 8px))" }}
      role="status"
    >
      {children}
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: Array<Array<string>> }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-esn">Show as table</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead className="text-left text-gray-500">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn("py-1 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => (
                <td key={i} className={cn("py-1", i > 0 && "text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Income and spending per month: paired bars. */
export function MonthlyBars({ points, height = 220 }: { points: MonthPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth();
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const { max, step } = niceScale(Math.max(...points.map((p) => Math.max(p.income, p.expenses)), 0));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / Math.max(points.length, 1);
  const bw = Math.max(3, Math.min(18, (slot - 10) / 2));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const bar = (x: number, v: number, color: string, key: string) => {
    const h = Math.max((v / max) * ih, v > 0 ? 1 : 0);
    const r = Math.min(4, h, bw / 2);
    const top = pad.t + ih - h;
    // Rounded at the data end, square on the baseline.
    return <path key={key} d={`M${x},${pad.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${pad.t + ih} Z`} fill={color} />;
  };
  const p = hover !== null ? points[hover] : null;
  return (
    <figure className="space-y-2" data-testid="chart-monthly">
      <Legend items={[["Income", INCOME], ["Spending", SPENDING]]} />
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="block max-w-full" role="img" aria-label="Income and spending per month" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={INK_MUTED}>
                {euro(t)}
              </text>
            </g>
          ))}
          {points.map((pt, i) => {
            const cx = pad.l + slot * i + slot / 2;
            return (
              <g key={pt.month}>
                {hover === i && <rect x={pad.l + slot * i + 2} y={pad.t} width={slot - 4} height={ih} fill="#f3f4f6" />}
                {bar(cx - bw - 1, pt.income, INCOME, "i")}
                {bar(cx + 1, pt.expenses, SPENDING, "s")}
                <text x={cx} y={height - 8} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                  {shortMonth(pt.month)}
                </text>
                {/* Hit target: the whole month's column. */}
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih + pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${pt.month}: income ${formatCents(pt.income)}, spending ${formatCents(pt.expenses)}`} />
              </g>
            );
          })}
        </svg>
        {p && hover !== null && (
          <Tooltip x={((pad.l + slot * hover + slot / 2) / W) * 100} y={(y(Math.max(p.income, p.expenses)) / height) * 100}>
            <p className="font-semibold text-gray-900">{shortMonth(p.month)} {p.month.slice(0, 4)}</p>
            <p className="flex justify-between gap-3"><span className="text-gray-500">Income</span><span className="tabular-nums">{formatCents(p.income)}</span></p>
            <p className="flex justify-between gap-3"><span className="text-gray-500">Spending</span><span className="tabular-nums">{formatCents(p.expenses)}</span></p>
            <p className="flex justify-between gap-3 border-t border-gray-100 pt-0.5"><span className="text-gray-500">Result</span><span className="tabular-nums font-medium">{formatCents(p.income - p.expenses)}</span></p>
          </Tooltip>
        )}
      </div>
      <TableView head={["Month", "Income", "Spending", "Result"]} rows={points.map((pt) => [pt.month, formatCents(pt.income), formatCents(pt.expenses), formatCents(pt.income - pt.expenses)])} />
    </figure>
  );
}

/** The running balance over the period: one line with a crosshair. */
export function BalanceLine({ points, start = 0, height = 180 }: { points: MonthPoint[]; start?: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth();
  const pad = { l: 44, r: 12, t: 16, b: 24 };
  const values = points.map((p) => start + p.balance);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const scale = niceScale(Math.max(hi - lo, 1));
  const min = lo < 0 ? -Math.ceil(-lo / scale.step) * scale.step : 0;
  const max = Math.max(min + scale.step, Math.ceil(hi / scale.step) * scale.step);
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const ticks: number[] = [];
  for (let t = min; t <= max + 1; t += scale.step) ticks.push(t);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const color = "#2E3192";
  return (
    <figure className="space-y-2" data-testid="chart-balance">
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="block max-w-full" role="img" aria-label="Running balance per month" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#9ca3af" : GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={INK_MUTED}>
                {euro(t)}
              </text>
            </g>
          ))}
          {points.length > 1 && <path d={`${d} L${x(points.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z`} fill={color} opacity={0.08} />}
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#9ca3af" strokeDasharray="3 3" />}
          {values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3} fill={color} stroke="#fff" strokeWidth={2} />
          ))}
          {points.map((p, i) => (
            <g key={p.month}>
              <text x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                {shortMonth(p.month)}
              </text>
              <rect x={x(i) - iw / Math.max(points.length, 2) / 2} y={pad.t} width={iw / Math.max(points.length, 2)} height={ih + pad.b} fill="transparent" onMouseEnter={() => setHover(i)} tabIndex={0} onFocus={() => setHover(i)} aria-label={`${p.month}: ${formatCents(values[i])}`} />
            </g>
          ))}
          {/* Direct label on the last point. */}
          {values.length > 0 && hover === null && (
            <text x={x(values.length - 1) - 6} y={y(values[values.length - 1]) - 9} textAnchor="end" fontSize={11} fontWeight={600} fill="#111827">
              {formatCents(values[values.length - 1])}
            </text>
          )}
        </svg>
        {hover !== null && (
          <Tooltip x={(x(hover) / W) * 100} y={(y(values[hover]) / height) * 100}>
            <p className="font-semibold text-gray-900">End of {shortMonth(points[hover].month)} {points[hover].month.slice(0, 4)}</p>
            <p className="tabular-nums">{formatCents(values[hover])}</p>
          </Tooltip>
        )}
      </div>
      <TableView head={["Month", "Balance"]} rows={points.map((p, i) => [p.month, formatCents(values[i])])} />
    </figure>
  );
}

/** Horizontal bars, largest first: one direction (income or spending) per list. */
export function BarList({ rows, color, testId }: { rows: Array<{ label: string; cents: number; note?: string }>; color: string; testId?: string }) {
  const max = Math.max(...rows.map((r) => r.cents), 1);
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.label} className="text-sm" title={`${r.label}: ${formatCents(r.cents)}${r.note ? ` · ${r.note}` : ""}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-gray-700">{r.label}</span>
            <span className="shrink-0 tabular-nums text-gray-900">{formatCents(r.cents)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full" style={{ width: `${Math.max((r.cents / max) * 100, 1)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Actual against plan: a bar with the plan as its track; over plan turns the label red (spending) or green (income). */
export function PlanBar({ planned, actual, direction }: { planned: number; actual: number; direction: "income" | "expense" }) {
  const scale = Math.max(planned, actual, 1);
  const over = actual > planned && planned > 0;
  const color = direction === "income" ? INCOME : SPENDING;
  return (
    <div className="w-full" title={`${formatCents(actual)} of ${formatCents(planned)} planned`}>
      <div className="relative h-2 rounded-full bg-gray-100">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(actual / scale) * 100}%`, background: color }} />
        {planned > 0 && <div className="absolute -top-1 h-4 w-0.5 bg-gray-700" style={{ left: `calc(${(planned / scale) * 100}% - 1px)` }} aria-hidden="true" />}
      </div>
      <p className={cn("mt-1 text-xs tabular-nums", over ? (direction === "expense" ? "font-semibold text-red-700" : "font-semibold text-emerald-700") : "text-gray-500")}>
        {formatCents(actual)} of {planned ? formatCents(planned) : "no plan"}
        {planned > 0 && ` · ${Math.round((actual / planned) * 100)}%`}
      </p>
    </div>
  );
}
