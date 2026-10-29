// `node design/gen-wordmark-options.mjs design/wordmark-options.html` – the
// comparison page: static, no script (the app CSP blocks inline scripts when
// it is served from public/ for a look on the dev server).
import { writeFileSync } from "node:fs";

const variants = [
  {
    id: "a",
    name: "A · Figtree 600, as now",
    note: "The current lettering with the pretzel in place of the star. One weight, one colour, tracking 0.04em. Calm, matches the old logo's “ESN”.",
    word: () => `<span class="w a">ESN MESA</span>`,
    events: "divider",
  },
  {
    id: "b",
    name: "B · Weight contrast: ESN 800 / MESA 400",
    note: "Figtree ExtraBold “ESN” (the network) and Regular “MESA” (the section): a hierarchy without extra colour, so the colourful pretzel stays the only colourful thing.",
    word: () => `<span class="w b"><b>ESN</b> <span>MESA</span></span>`,
    events: "divider",
  },
  {
    id: "c",
    name: "C · Colour contrast: MESA in pretzel orange",
    note: "Figtree 700; “MESA” takes the pretzel's dominant orange. Ties text and mark together, but adds a fifth colour block next to an already busy mark; orange on white is weak (2.9:1).",
    word: () => `<span class="w c"><span class="e">ESN</span> <span class="m">MESA</span></span>`,
    events: "divider",
  },
  {
    id: "d",
    name: "D · Stacked: ESN over spaced MESA",
    note: "Two lines that together are as tall as the pretzel, like a classic lock-up. Narrow (good at 375 px), but “MESA” at 11 px is small again: the problem the old PNG logo had.",
    word: () => `<span class="w d"><span class="e">ESN</span><span class="m">MESA</span></span>`,
    events: "pill",
  },
  {
    id: "e",
    name: "E · Rounded: Nunito 800",
    note: "Nunito's rounded terminals echo the rounded corners of the pretzel's tiles. Friendly, a bit softer than ESN's official geometric type.",
    word: () => `<span class="w e">ESN MESA</span>`,
    events: "divider",
  },
  {
    id: "f",
    name: "F · Outfit 600",
    note: "A crisp geometric sans with round O/S shapes; tighter than Figtree. Modern, but further from ESN's official lettering.",
    word: () => `<span class="w f">ESN MESA</span>`,
    events: "divider",
  },
];

const events = (kind, size) =>
  kind === "pill" ? `<span class="pill ${size}">Events</span>` : `<span class="ev ${size}">Events</span>`;

const mark = (v, { tone, size, product }) =>
  `<span class="mark ${tone} ${size}"><img src="pretzel-color.svg" alt="" class="pz"> ${v.word()}${product ? events(v.events, size) : ""}</span>`;

const header = (v, mobile) => `
<div class="hdr${mobile ? " mobile" : ""}">
  <div class="bar">
    ${mark(v, { tone: "light", size: "md", product: true })}
    <span class="right"><span class="av">CN</span>${mobile ? "" : `<span class="who"><b>Cevin Neubauer</b><small>Board · Events</small></span>`}<span class="out">Sign out</span></span>
  </div>
  <div class="nav"><span class="on">Home</span><span>Events</span><span>Schedule</span><span>Team</span></div>
</div>`;

const login = (v) => `
<div class="loginbg"><div class="card">
  ${mark(v, { tone: "dark", size: "lg" })}
  <h1>Events</h1>
  <p>Sign in with your @esn-mesa.de account</p>
  <span class="gbtn">Sign in with Google</span>
</div></div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESN MESA wordmark options</title>
<style>
@font-face { font-family: Figtree; src: url(fonts/figtree-var-latin.woff2) format("woff2"); font-weight: 300 900; }
@font-face { font-family: Nunito; src: url(fonts/nunito-var-latin.woff2) format("woff2"); font-weight: 200 1000; }
@font-face { font-family: Outfit; src: url(fonts/outfit-var-latin.woff2) format("woff2"); font-weight: 100 900; }
:root { --esn: #2E3192; --orange: #F47920; }
* { box-sizing: border-box; }
body { margin: 0; background: #f3f4f6; color: #111827; font: 15px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
main { max-width: 1240px; margin: 0 auto; padding: 32px 24px 64px; }
h1.page { font-size: 26px; margin: 0 0 4px; }
.intro { color: #4b5563; max-width: 70ch; margin: 0 0 32px; }
section.variant { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 20px 24px; margin-bottom: 28px; }
section.variant h2 { font-size: 18px; margin: 0; }
section.variant .note { color: #4b5563; margin: 4px 0 16px; max-width: 80ch; }
.label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 14px 0 6px; }
.row { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }

/* App header mock: bg-esn, h-16, max-w-6xl px-4, gap-4 (app/(app)/layout.tsx) */
.hdr { width: 1180px; max-width: 100%; background: var(--esn); color: #fff; box-shadow: 0 4px 6px -1px rgb(0 0 0 / .1); font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
.hdr.mobile { width: 375px; }
.hdr .bar { height: 64px; padding: 0 16px; display: flex; align-items: center; gap: 16px; }
.hdr .right { margin-left: auto; display: flex; align-items: center; gap: 12px; min-width: 0; }
.hdr .av { width: 36px; height: 36px; border-radius: 50%; background: rgb(255 255 255 / .15); box-shadow: 0 0 0 2px rgb(255 255 255 / .4); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; flex-shrink: 0; }
.hdr .who { line-height: 1.25; } .hdr .who b { display: block; font-size: 14px; font-weight: 500; } .hdr .who small { font-size: 12px; color: rgb(255 255 255 / .7); }
.hdr .out { border: 1px solid rgb(255 255 255 / .3); border-radius: 8px; padding: 6px 12px; font-size: 14px; font-weight: 500; white-space: nowrap; }
.hdr .nav { display: flex; gap: 4px; padding: 0 16px 8px; font-size: 14px; color: rgb(255 255 255 / .8); }
.hdr .nav span { padding: 6px 10px; border-radius: 6px; } .hdr .nav .on { background: rgb(255 255 255 / .15); color: #fff; }

/* Login card mock (app/login/page.tsx) */
.loginbg { background: #f9fafb; padding: 32px; width: 460px; max-width: 100%; display: flex; justify-content: center; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 1px 2px rgb(0 0 0 / .05); padding: 32px; width: 384px; text-align: center; }
.card h1 { font-size: 20px; margin: 16px 0 0; } .card p { font-size: 14px; color: #6b7280; margin: 4px 0 24px; }
.card .gbtn { display: block; border: 1px solid #d1d5db; border-radius: 6px; padding: 10px; font-size: 14px; font-weight: 500; color: #374151; }

/* The brand mark */
.mark { display: inline-flex; align-items: center; flex-shrink: 0; white-space: nowrap; }
.mark.md { gap: 12px; } .mark.lg { gap: 14px; }
.mark .pz { display: block; flex-shrink: 0; }
.mark.md .pz { height: 40px; } .mark.lg .pz { height: 60px; }
.mark .w { line-height: 1; text-box: trim-both cap alphabetic; }
.mark.md .w { font-size: 28px; } .mark.lg .w { font-size: 40px; }
.mark.light .w { color: #fff; } .mark.dark .w { color: var(--esn); }
.ev { font-weight: 500; line-height: 1; border-left: 1px solid; padding-left: 12px; margin-left: 2px; align-self: center; }
.mark.light .ev { color: rgb(255 255 255 / .75); border-color: rgb(255 255 255 / .3); font-size: 18px; padding-block: 3px; }
.mobile .ev, .mobile .pill { display: none; }
/* Phones: the header has about 200 px for the mark next to avatar and Sign out. */
.mobile .mark.md { gap: 10px; } .mobile .mark.md .pz { height: 36px; } .mobile .mark.md .w { font-size: 26px; } .mobile .mark.md .w.d { font-size: 25px; }
.pill { font-size: 13px; font-weight: 600; letter-spacing: .02em; line-height: 1; padding: 5px 9px; border-radius: 999px; background: rgb(255 255 255 / .14); color: rgb(255 255 255 / .9); margin-left: 4px; }

.w.a { font-family: Figtree; font-weight: 600; letter-spacing: .04em; }
.w.b { font-family: Figtree; letter-spacing: .03em; } .w.b b { font-weight: 800; } .w.b span { font-weight: 400; }
.mark.light .w.b span { color: rgb(255 255 255 / .92); }
.w.c { font-family: Figtree; font-weight: 700; letter-spacing: .03em; } .w.c .m { color: var(--orange); }
.w.d { font-family: Figtree; display: inline-flex; flex-direction: column; align-items: stretch; text-box: none; }
.w.d .e { font-weight: 800; letter-spacing: .04em; font-size: 1em; line-height: .78; }
.w.d .m { font-weight: 600; font-size: .39em; letter-spacing: .38em; margin-right: -.38em; line-height: 1; margin-top: .24em; }
.mark.md .w.d { font-size: 27px; } .mark.lg .w.d { font-size: 42px; }
.w.e { font-family: Nunito; font-weight: 800; letter-spacing: .03em; }
.w.f { font-family: Outfit; font-weight: 600; letter-spacing: .03em; }
</style>
</head>
<body>
<main>
<h1 class="page">ESN MESA wordmark options</h1>
<p class="intro">The coloured pretzel with six “ESN MESA” letterings, each in the app header (desktop and 375 px phone width, where “Events” is hidden as in the app) and on the login card. Cap height about 20 px in the 64 px header, as the old logo's “ESN”. All fonts are free (SIL OFL) and self-hosted. Chosen: <b>B</b>, now in <code>components/BrandMark.tsx</code>; see <code>README.md</code> for the reasoning.</p>
${variants
  .map(
    (v) => `<section class="variant" id="v-${v.id}">
<h2>${v.name}</h2>
<p class="note">${v.note}</p>
<div class="label">Header, desktop</div>
<div class="shot" data-shot="${v.id}-header">${header(v, false)}</div>
<div class="row">
  <div><div class="label">Header, 375 px</div><div class="shot" data-shot="${v.id}-mobile">${header(v, true)}</div></div>
  <div><div class="label">Login card</div><div class="shot" data-shot="${v.id}-login">${login(v)}</div></div>
</div>
</section>`
  )
  .join("\n")}
</main>
</body>
</html>
`;
writeFileSync(process.argv[2], html);
