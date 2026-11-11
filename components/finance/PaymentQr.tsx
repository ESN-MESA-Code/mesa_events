"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, Maximize2, Printer } from "lucide-react";
import { formatCents } from "@/lib/dates";

export interface PayLink {
  reference: string;
  title: string;
  amount: number | null;
  url: string;
  /** "ESN MESA e.V." – who the payer sees. */
  accountName: string;
  /** "Office hour, Tue 4 Nov" */
  context?: string | null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A PayPal link's QR code with its reference (round 2026-11-11): copy the
 * link or the reference, download the code, print an A5 sign or show it
 * full screen at the counter. The payer scans it, pays and writes the
 * reference into the PayPal note.
 */
export function PaymentQr({ link, size = 148, compact = false }: { link: PayLink; size?: number; compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement>(null);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (canvas.current) QRCode.toCanvas(canvas.current, link.url, { width: size, margin: 1, errorCorrectionLevel: "M" });
  }, [link.url, size]);
  useEffect(() => {
    if (!full) return;
    if (big.current) QRCode.toCanvas(big.current, link.url, { width: Math.min(window.innerWidth, window.innerHeight) * 0.6, margin: 2 });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full, link.url]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied("Copy failed");
    }
  };

  async function print() {
    const png = await QRCode.toDataURL(link.url, { width: 600, margin: 2 });
    const w = window.open("", "_blank", "width=700,height=900");
    if (!w) return;
    const amount = link.amount ? formatCents(link.amount) : "";
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(link.reference)}</title>
<style>@page{size:A5;margin:12mm}body{font-family:system-ui,sans-serif;text-align:center;color:#111}h1{font-size:28px;margin:0 0 4px}p{margin:4px 0}
.amount{font-size:40px;font-weight:700;color:#2E3192}.ref{font-family:ui-monospace,monospace;font-size:34px;font-weight:700;letter-spacing:2px;border:3px dashed #2E3192;display:inline-block;padding:6px 14px;margin:8px 0}
img{width:300px;height:300px}.small{font-size:13px;color:#555}</style></head><body>
<h1>${escapeHtml(link.title)}</h1>${link.context ? `<p class="small">${escapeHtml(link.context)}</p>` : ""}
${amount ? `<p class="amount">${escapeHtml(amount)}</p>` : ""}
<img src="${png}" alt="QR code"><p>Scan, pay with PayPal to <strong>${escapeHtml(link.accountName || "ESN MESA")}</strong> and write this in the note:</p>
<div class="ref">${escapeHtml(link.reference)}</div>
<p class="small">Scannen, mit PayPal bezahlen und die Referenz in die Mitteilung schreiben.</p>
<p class="small">${escapeHtml(link.url)}</p>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  function download() {
    if (!canvas.current) return;
    const a = document.createElement("a");
    a.href = canvas.current.toDataURL("image/png");
    a.download = `${link.reference}.png`;
    a.click();
  }

  const btn = "inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-esn hover:bg-gray-100";
  return (
    <div className={compact ? "flex items-center gap-3" : "flex flex-col items-center gap-2"} data-testid={`qr-${link.reference}`}>
      <canvas ref={canvas} className="rounded border border-gray-100" aria-label={`QR code for ${link.title}`} />
      <div className={compact ? "min-w-0 space-y-1" : "space-y-1 text-center"}>
        <p className="font-mono text-base font-bold tracking-wider text-gray-900">{link.reference}</p>
        <div className={compact ? "flex flex-wrap gap-0.5" : "flex flex-wrap justify-center gap-0.5"}>
          <button type="button" className={btn} onClick={() => copy(link.url, "Link copied")}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Link
          </button>
          <button type="button" className={btn} onClick={() => copy(link.reference, "Reference copied")}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Reference
          </button>
          <button type="button" className={btn} onClick={download}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> PNG
          </button>
          <button type="button" className={btn} onClick={print}>
            <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Sign
          </button>
          <button type="button" className={btn} onClick={() => setFull(true)}>
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Show
          </button>
        </div>
        {copied && (
          <p className="text-xs text-emerald-700" role="status">
            {copied}
          </p>
        )}
      </div>
      {full && (
        <div role="dialog" aria-modal="true" aria-label={`Pay ${link.title}`} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{link.title}</p>
          {link.amount && <p className="text-4xl font-bold text-esn">{formatCents(link.amount)}</p>}
          <canvas ref={big} />
          <p className="text-lg text-gray-700">Pay with PayPal and write in the note:</p>
          <p className="rounded-lg border-4 border-dashed border-esn px-6 py-2 font-mono text-4xl font-bold tracking-widest">{link.reference}</p>
          <button type="button" autoFocus onClick={() => setFull(false)} className="mt-2 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
