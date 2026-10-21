# Dither Dally — Design

Status: Phase 4 complete · Last updated: 2026-10-19

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

### 3.4b Threshold fields and cell fills

Most non-diffusion algorithms reduce to one of two shared engines:

- **Threshold field** (`field.ts`): each pixel gets a rank in [0, 1), its
  place in the inking order. The rank becomes an offset of up to half a
  palette step before nearest-colour matching. Bayer, blue/white noise,
  halftone dots and crosshatch are all just different rank functions, and all
  work with any palette, not only black and white.
- **Cell fill** (`cells.ts`): a partition of the image into cells (square
  grid, Voronoi, hexagons, triangles), each filled with the palette colour
  nearest its average. Optional outlines and shape masks are shared.

Halftone dot ranks are exact *coverage*: the rank of a point is the share
of the cell a dot covers when it reaches that point (analytic circle,
diamond, square and line areas), so ink coverage equals tone.

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

A document is an ordered list of **layers**, run top to bottom
(`pipeline.ts`): exactly one **dither layer** plus any number of **effect
layers** before or after it, each with an `enabled` flag and its own
settings. Effects before the dither shape the image going in; effects after
it treat the dithered result and may add colours outside the palette on
purpose (a tint, a glow).

Effects (`effects.ts`) are full-colour `EffectDefinition`s with the same
self-describing control schema as algorithms (plus a `color` control kind):

| Category | Effects |
|---|---|
| Adjust | Adjust (brightness, contrast, midtones, saturation, hue), Blur, Sharpen, Invert, Grain |
| Light & colour | Tint (multiply, screen, overlay, soft light, darken, lighten, difference, colour; W3C compositing formulas), Bloom, Vignette |
| Glitch | Chromatic split, Scanlines, Row shift |

Sizes (blur radius, distances) are in working pixels, i.e. after the pixel
size is applied, so the look scales with it. Each effect layer's seed is the
document seed mixed with a hash of the layer id: two Grain layers differ, and
reordering doesn't change either one's pattern.

Layer list operations (`layers.ts`: move, insert, remove) are pure functions
in core with their own tests; the UI only calls them.

**Palette extraction** (`extract.ts`): k-means in OKLab with a seeded
k-means++ start (≤ 40,000 sampled pixels, 16 iterations), returning 2–16
colours sorted by perceived lightness. The result is stored in the preset as
a custom palette.

### 3.7 Presets and sharing

Settings (never the image) are a versioned JSON preset:

```ts
interface Preset {               // version 2, Phase 3
  version: 2;
  layers: Layer[];               // exactly one { kind: "dither" }
  palette: string | { name: string; colors: string[] };  // built-in id or custom hex list (2–64)
  pixelSize: number;             // 1–8
  seed: number;
  color: ColorSettings;
}
```

Version 1 presets (Phase 1–2: a single `algorithm` + `params`) are migrated
on load into a one-layer version 2 document, so old links keep working
(covered by a test using a real Phase 1 link).

- **Links:** the app keeps the current preset in the URL as
  `#p=<base64url JSON>`, so copying the address shares the exact look. The
  hash never reaches a server.
- **Files:** Save/Load as `*.dither-dally.json`. Dropping a preset file on
  the app loads it.
- **Validation:** presets come from strangers, so `parsePreset` treats them as
  untrusted. It rejects wrong versions and missing layer lists; otherwise it
  clamps sliders to range and step, checks toggles, selects and colours,
  drops unknown effects and keys, repairs duplicate layer ids, guarantees
  exactly one dither layer, caps the stack at 32 layers, and falls back to
  defaults — reporting every fix as a warning the UI shows.

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
| 2 ✓ | error diffusion | Riemersma (Hilbert curve, fading error memory) | published |
| 2 ✓ | halftone | Halftone (round/diamond/square/line dots, any angle, any palette); CMYK halftone (classic angles, GCR) | technique |
| 2 ✓ | pattern | Crosshatch, Shape grid (circle/square/diamond/heart), Voronoi cells | technique |
| 2 ✓ | polygon | Hexagons, Triangles | technique |
| 4 ✓ | lines | Wave lines, Rings, Spiral (line screens: rank = distance from the line centre, so coverage tracks tone); Engraving (a line screen displaced by the smoothed brightness) | original |
| 4 ✓ | pattern | Contours (topographic iso-lines of smoothed brightness) | original |
| 4 ✓ | glitch | Streak (error carried along rows or columns only), Slip (Floyd–Steinberg whose error is handed down with random sideways jolts) | original |
| 4+ ✓ | text | ASCII (tone or shape matched), Braille | technique |
| later | error diffusion | Ostromoukhov (variable coefficients) — needs the paper's 256-entry table from the primary source | published |

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
  Live at <https://wizardnun.github.io/dither-dally/>, deployed on every push
  to `main`.
- **Phase 2 ✓** Halftone, CMYK halftone, crosshatch, shape grid, Voronoi,
  hexagons, triangles, Riemersma (22 styles in 6 families). Style gallery.
  Deferred: Ostromoukhov (needs the primary-source coefficient table) and
  WebGPU (every style renders in ~1–12 ms on a 200×120 image on the CPU, so
  the complexity isn't justified yet; revisit with video).
- **Phase 3 ✓** Layer stack with 11 effects, preset version 2 (with v1
  migration), palette extraction, undo/redo, batch export.
- **Phase 4 ✓** Seven original styles in two new families (Line screens,
  Glitch) plus Contours; video: open, scrub, play and export MP4 with the
  layer stack applied to every frame and the audio kept.

### Phase 4 decisions

- **Engraving is a displaced line screen.** The first version projected each
  pixel onto a locally estimated edge direction (structure tensor). Because
  the projection uses absolute coordinates, small direction changes far from
  the origin swung the line phase wildly and curved areas turned to noise.
  Displacing a straight screen by smoothed brightness keeps the line phase a
  continuous function of position, so lines bend but never break up. A test
  pins it: with no bend it is identical to an unwaved Wave lines screen.
- **Video uses [mediabunny](https://github.com/Vanilagy/mediabunny)**
  (MPL-2.0, pinned to 1.61.0) for demuxing, WebCodecs decode/encode and MP4
  muxing. Its `Conversion` API with a `video.process` callback lets every
  frame go through the same render worker as images while audio is copied
  untouched. Writing a muxer ourselves wasn't worth the risk.
- **Lazy loading.** The video module and library (~550 KB, ~138 KB gzip)
  load only when a video is opened; the main bundle stays ~315 KB.
- **Seeking without an index.** Files without a seek index (typical of
  browser and screen recordings) return no frame from direct lookup. The
  session then switches to reading sequentially from the requested time,
  which mediabunny supports and which takes ~20–50 ms per seek on test clips.
- **Preview playback** is paced in real time and drops late frames; it is
  silent. Export processes every frame.
- **Flicker.** Error-diffusion styles re-scatter their dots every frame,
  which shimmers in video. The export sheet says so and suggests styles
  whose pattern is tied to the pixel grid (ordered, halftone, line screens,
  pattern, polygon), where still areas stay still.
- **Same resolution rule as images.** Video frames are processed at the
  preview size, then scaled by the pixel size; the output size is kept even
  because H.264 requires it. The codec is the first one the browser can
  encode that MP4 supports.

### Text art (after Phase 4)

A **Text** family turns images into real characters (`text.ts`, `font.ts`):

- **ASCII**: the image is split into character cells sized for monospace
  fonts (width ∶ height = 0.6, so pasted text keeps its proportions). Each
  cell is sampled at the glyph's 6×8 resolution and the character chosen by
  - *Tone*: glyph ink coverage closest to the cell's brightness, mapped onto
    the coverage range of the chosen set; or
  - *Shape* (default): tone plus a correlation term between the cell's
    zero-mean pattern and each glyph's, so edges pick matching strokes
    (`|` `-` `/` …). Correlation is zero on flat cells, so flat areas are
    decided by tone alone; an earlier squared-difference version biased flat
    areas toward low-variance glyphs and was replaced (tests pin it).
  Character sets: Classic, Detailed (every glyph), Simple, Blocks (░▒▓█),
  Binary, or a custom string (characters the font can't draw are skipped).
- **Braille**: each cell is a 2×4 Unicode Braille dot grid, Floyd–Steinberg
  (or threshold) at dot resolution — 8 dots per character.
- **Colour modes**: dark on light, light on dark, or per-character palette
  colour on the darkest palette colour.
- **Font**: our own 5×7 pixel font drawn for the project (about 60 glyphs)
  plus generated shading blocks, so rendering is identical everywhere and the
  core stays DOM-free.
- **Real text out**: Copy as text, Save .txt, and Save HTML (a standalone
  page; coloured runs merged into spans; content escaped). The text is built
  from exactly the image the preview feeds into the dither layer
  (`runUntilDither`), so it matches what you see.
- **Legibility**: glyphs need ≥ 6 px per character to draw cleanly in the
  picture. When a setting goes below that, the inspector says so with the
  exact limit; the exported text is unaffected.

### Testing video

There is no unit test for the video path (it needs a browser with
WebCodecs). It was verified end to end in headless Edge: a clip with audio
recorded in the page by MediaRecorder was opened, scrubbed, played, exported
to MP4 with Bayer applied, and the export re-opened as a valid video with
its audio track. Not yet tested: Safari and Firefox, very long or high
resolution videos, variable-frame-rate phone footage.

### Phase 3 decisions

- **Export is WYSIWYG.** Export and batch export render at the same working
  resolution as the preview (long side ≤ 1,600 px, then scaled by pixel
  size). Effect sizes are in working pixels, so rendering at another
  resolution would change the look. A separate full-resolution export can
  come later if it rescales effect sizes consistently.
- **One dither layer.** Several dither layers rarely make sense (the second
  re-dithers an already-quantised image) and would complicate the palette
  and the style gallery. The format allows revisiting this.
- **Undo** covers every document change (layers, settings, palette, preset
  loads). Rapid changes to the same control within 700 ms merge into one
  step, so a slider drag undoes in one go. The image itself and view state
  (zoom, panels) are not part of the history.

## 10. Interface

Mac-style editor (see `apps/web/src/styles.css` header): unified toolbar,
floating glass inspector on the right, zoomable canvas with split / side by
side / result-only compare.

**Choosing a style.** Styles are picked from a **gallery** rather than a
permanent list, so the catalogue can grow without crowding the window:

- Opened from the style card at the top of the inspector, the toolbar's
  Styles button, or Ctrl/⌘ K.
- Docks beside the inspector (the canvas re-fits so the whole image stays
  visible); categories with counts, search across names, summaries and
  authors, and live thumbnails of the user's own image.
- Hovering or arrowing through cards previews that style on the canvas;
  click or Enter applies it; Escape or clicking the canvas cancels.
- On narrow screens it covers the canvas, with categories as a chip row.

**Layers** (left panel): the stack in processing order between "Your image"
and "Output". Click to select (the inspector shows that layer), drag or
Alt + ↑/↓ to reorder, eye to hide, Delete or the bin to remove an effect,
**+** for a categorised effect menu (new effects go just below the selected
layer). Badges are coloured by category; the dither layer has a checkerboard.

**Export menu** (toolbar): Export PNG (Ctrl/⌘ E) or Batch export…, which
asks for images, confirms in a sheet, then writes into a chosen folder where
the browser supports it (Chromium) or downloads each file otherwise.
