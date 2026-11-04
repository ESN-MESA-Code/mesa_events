// Figtree – the wordmark's font (design/README.md), since the shell redesign
// (2026-11-04) the font of all text. Self-hosted: no request to Google.
import localFont from "next/font/local";

export const figtree = localFont({ src: "./fonts/figtree-var-latin.woff2", weight: "400 800", display: "swap", variable: "--font-figtree" });
