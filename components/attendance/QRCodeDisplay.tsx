"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

interface Props {
  /** Absolute, from the server – the same text on the server and in the browser (usability review #24). */
  url: string;
  size?: number;
  /** Shown above the full-screen code. */
  title?: string;
}

export default function QRCodeDisplay({ url, size = 200, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: size, margin: 2 });
    }
  }, [url, size]);

  // Full screen for projecting it (usability review #26): as large as the screen allows.
  useEffect(() => {
    if (!full) return;
    if (bigRef.current) QRCode.toCanvas(bigRef.current, url, { width: Math.min(window.innerWidth, window.innerHeight) * 0.8, margin: 2 });
    overlayRef.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    const onExit = () => !document.fullscreenElement && setFull(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onExit);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onExit);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [full, url]);

  function handleDownload() {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.href = canvasRef.current.toDataURL("image/png");
    link.download = "event-qr.png";
    link.click();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas ref={canvasRef} />
      <div className="flex flex-wrap justify-center gap-4">
        <button type="button" onClick={() => setFull(true)} className="text-sm font-medium text-esn hover:underline">
          Show QR full screen
        </button>
        <button type="button" onClick={handleDownload} className="text-sm text-esn hover:underline">
          Download QR Code
        </button>
      </div>
      <p className="text-xs text-gray-400 break-all max-w-xs text-center">{url}</p>
      {full && (
        <div ref={overlayRef} role="dialog" aria-modal="true" aria-label="QR code, full screen" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-4" data-testid="qr-full">
          {title && <p className="text-center text-2xl font-bold text-gray-900">{title}</p>}
          <canvas ref={bigRef} />
          <p className="text-center text-lg text-gray-700">Scan to sign in</p>
          <button type="button" autoFocus onClick={() => setFull(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
