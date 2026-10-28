"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface Props {
  url: string;
  size?: number;
}

export default function QRCodeDisplay({ url, size = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: size, margin: 2 });
    }
  }, [url, size]);

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
      <button
        type="button"
        onClick={handleDownload}
        className="text-sm text-esn hover:underline"
      >
        Download QR Code
      </button>
      <p className="text-xs text-gray-400 break-all max-w-xs text-center">{url}</p>
    </div>
  );
}
