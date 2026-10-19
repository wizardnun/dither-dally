# Dither Dally — Design

Status: Phase 1 complete · Last updated: 2026-10-19

## 1. What we're building

Dither Dally is a dithering studio that runs in the browser. You open a link,
drop in an image, stack effects, tune them with sliders, compare before and
after, and export. No install, no account, works offline once loaded.

### Goals

- **An app people use.** The web app is the product. Everything else serves it.
- **Fast enough to feel live.** Previews update while you drag a slider.
- **A broad, well-explained algorithm library.** Classic error diffusion and
  ordered dithering, halftone, pattern and polygon styles, and our own effects.
- **Reproducible.** The same image, settings and seed always give the same
  pixels, on every machine.
- **Easy to contribute to.** Adding an algorithm means adding one module and
  one registry entry; the UI builds its controls automatically.

### Non-goals (for now)

- A general photo editor. Adjustments exist only to feed the dither.
- A native desktop app. A Tauri wrapper is possible later.
- A server. All processing happens on the user's device.

## 2. Architecture

```
apps/web (React UI) ──postMessage──▶ Web Worker ──calls──▶ packages/core
        ▲                                 │                      │
        └──────── ImageData result ◀──────┘          (later) packages/gpu
```

| Package | Role | Depends on |
|---|---|---|
| `packages/core` | Pure TypeScript algorithms and the pipeline. No DOM, no browser APIs. Runs in a worker or in Node (for tests and a future CLI). | nothing |
| `packages/gpu` *(phase 2)* | WebGPU (WGSL) versions of the per-pixel-parallel families, behind the same interface as core. | core |
| `apps/web` | React + Vite UI. Owns state, files, preview and export. Runs core inside a Web Worker. | core |

### Why this shape

- **Core has no DOM.** It takes and returns raw pixel buffers, so it can be
  unit-tested in Node, run in a worker, and have any single module replaced by
  a faster implementation (WebGPU, or Rust/WASM) without touching the UI.
- **The UI thread never processes pixels.** Work happens in a Web Worker so
  sliders stay responsive. Pixel buffers are transferred, not copied.
- **Preview vs export.** Previews render at screen resolution; export renders
  at full resolution. Settings are resolution-independent wherever possible
  (sizes are in output pixels, not percentages of an assumed size).

## 3. Core concepts

### 3.1 Pixel buffer

```ts
interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major, 4 bytes per pixel
}
```

Structurally compatible with the browser's `ImageData`, so no conversion is
needed at the worker boundary.

### 3.2 Palette

A palette is an ordered list of RGB colours. Algorithms only ever output
palette colours (alpha is preserved from the source). Colour depth is applied
by taking the first N entries.

### 3.3 Algorithm definition

Every algorithm describes itself. The UI and any future CLI are generated from
this description; nothing is hard-coded per algorithm in the UI.

```ts
interface AlgorithmDefinition<P> {
  id: string;            // stable, kebab-case, never renamed once released
  name: string;          // display name
  family: Family;        // "basic" | "error-diffusion" | "ordered" | ...
  summary: string;       // one sentence, our own words
  reference?: Reference; // paper / author / year for published algorithms
  controls: Control[];   // sliders, toggles, selects — with ranges & defaults
  run(input: PixelBuffer, palette: Palette, params: P, ctx: RunContext): PixelBuffer;
}
```

`RunContext` carries the seed (for anything random) and the colour settings
(§3.5). Adding an algorithm = write a module that exports a definition, add it
to `registry.ts`, add tests.

### 3.4 Error diffusion as data

All classic error-diffusion algorithms share one engine. Each is just a kernel:
a divisor plus a list of `(dx, dy, weight)` taps to the right of and below the
current pixel. Scan order (raster or serpentine; Hilbert curve later) is a
separate option. Error strength scales the diffused error.

### 3.5 Colour handling

Two independent choices, exposed as settings (`ColorSettings`):

| Setting | Options | Default |
|---|---|---|
| Diffusion space | `srgb` (classic, punchier) · `linear` (physically correct brightness) | `srgb` |
| Matching metric | `srgb` (squared sRGB distance) · `oklab` (perceptual) | `srgb` |

They change the look noticeably, so they are always explicit, never silent.
Defaults stay classic so results match other dithering tools and the golden
tests from Phase 0 stay byte-identical.

Implementation (`colorspace.ts`): a `ColorModel` converts pixels into a
working space and finds the nearest palette entry. Working values use a 0–255
scale in both spaces (linear light × 255), so error strength behaves the same.
Accumulated error may push values outside 0–255; transfer functions clamp
before converting, while the classic sRGB/sRGB path is left unclamped so it
reproduces the textbook algorithms exactly.

The diffusion space only affects error diffusion. Threshold-based methods
(Bayer, noise, threshold) add their offsets in sRGB, where palette steps look
even, and use only the matching metric.

Weighted RGB was dropped: OKLab covers the same need better.

### 3.6 Pipeline

A document will be an ordered list of layers, each with an `enabled` flag and
its own settings. Planned layer types: adjustments, dither, halftone, tint,
glow, chromatic split, glitch, post-processing (Phase 3).

### 3.7 Presets and sharing

Settings (never the image) are a versioned JSON preset:

```ts
interface Preset {               // version 1, Phase 1
  version: 1;
  algorithm: string;             // algorithm id
  params: Params;                // that algorithm's control values
  palette: string;               // palette id
  pixelSize: number;             // 1–8
  seed: number;
  color: ColorSettings;
}
```

- **Links:** the app keeps the current preset in the URL as
  `#p=<base64url JSON>`, so copying the address shares the exact look. The
  hash never reaches a server.
- **Files:** Save/Load as `*.dither-dally.json`. Dropping a preset file on
  the app loads it.
- **Validation:** presets come from strangers, so `parsePreset` treats them as
  untrusted. It rejects wrong versions and unknown algorithms; otherwise it
  clamps sliders to range and step, checks toggles and selects, drops unknown
  keys and falls back to defaults, reporting every fix as a warning the UI
  shows.
- **Versioning:** Phase 3's layer stack will be version 2, with a migration
  from version 1.

### 3.8 Offline and install

The app is an installable PWA (`manifest.webmanifest`, `sw.js`). The service
worker is network-first: online you always get the latest build; anything
fetched successfully is cached for offline use. On first visit the page
sends the service worker the files it already loaded, so it works offline
after one visit. Production builds only.

## 4. Algorithm roadmap

Tiers: **published** = from a paper or well-known kernel · **technique** =
standard graphics method, our parameters · **original** = designed by us.

| Phase | Family | Algorithms | Tier |
|---|---|---|---|
| 0 | basic | Threshold, Nearest colour | technique |
| 0 | error diffusion | Floyd–Steinberg, Atkinson, Burkes, Jarvis–Judice–Ninke, Stucki, Sierra, Two-row Sierra, Sierra Lite, Stevenson–Arce | published |
| 0 | ordered | Bayer 2/4/8/16, white noise | published / technique |
| 1 ✓ | ordered | Blue noise (void-and-cluster, generated from the seed, 32² or 64² tile) | published |
| 2 | error diffusion | Riemersma (Hilbert curve), Ostromoukhov (variable coefficients) | published |
| 2 | halftone | Grayscale and CMYK AM screens, GCR, screen angles | technique |
| 2 | pattern / polygon | Shape grids, crosshatch, stippling, Voronoi, hex/tri tessellation | technique |
| 4 | original | Line-diffusion glitch family, wave and contour fields | original |

## 5. Performance plan

1. Phase 0: plain TypeScript in a worker. Typed arrays, no per-pixel
   allocation. Measure.
2. Phase 2: WebGPU compute shaders for families where every pixel is
   independent (ordered, pattern, polygon, field-based). Keep the CPU version
   as fallback and as the reference for tests.
3. Only if profiling shows a real bottleneck (e.g. diffusion on 4K video):
   rewrite that one module in Rust → WASM behind the same interface.

## 6. Testing

- **Unit tests** (Vitest, Node) for colour maths, kernels, Bayer matrices.
- **Property tests**: output contains only palette colours; alpha is
  preserved; output dimensions match; deterministic for a fixed seed.
- **Golden tests**: a fixed synthetic test image per algorithm, hashed and
  snapshotted. Any change in output must be deliberate and reviewed.
- GPU implementations are tested against the CPU reference.

## 7. Clean-room policy

Dither Dally is inspired by existing dithering tools, including proprietary
ones. To keep the project clean:

- Never copy code, text, palette data or effect names from proprietary tools,
  and never decompile or port from their binaries or bytecode.
- Published algorithms are implemented from their papers or from widely
  documented kernels; cite the source in the definition's `reference`.
- Original effects are designed from a description of the visual result,
  written in our own words, and get our own names.
- Palettes are our own, public-domain/standard sets (CGA, EGA, Game Boy…),
  or extracted from the user's own images.

See `CONTRIBUTING.md` for the contributor-facing version.

## 8. Open questions

- Video: WebCodecs support is good in Chromium; what's the fallback for
  browsers without `VideoEncoder`?
- Should OKLab become the default matching metric once there are more
  colourful palettes? (Would require regenerating golden snapshots.)

### Resolved

- **Blue noise source (Phase 1):** generated at runtime by void-and-cluster
  from the seed, cached per size and seed. Measured ~6 ms for 32² and ~58 ms
  for 64² (Node 24, desktop), once per size and seed. No binary asset to
  license, and the seed control gives different grain.
- **Preset sharing (Phase 1):** both links and files (§3.7).

## 9. Status

- **Phase 0 ✓** Core, classic diffusion, Bayer, white noise, worker-based app.
- **Phase 1 ✓** Colour settings (linear light, OKLab), blue noise, preset
  links and files, PWA, GitHub Pages workflow (`.github/workflows/pages.yml`).
  Not yet deployed: the repository isn't on GitHub yet.
