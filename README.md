# Dither Dally

An open-source dithering studio for the browser. Drop in an image, pick an
algorithm and a palette, tune it live, export.

**Try it:** <https://wizardnun.github.io/dither-dally/>

> Early development: the four planned phases are done. See
> [docs/DESIGN.md](docs/DESIGN.md) for the design and what's next.

- **Video:** open an MP4 or WebM, scrub and play it with your look applied,
  and export a dithered MP4 that keeps the original sound.
- **ASCII and Braille art:** turn any image into real text, with characters
  chosen to match both brightness and shape. Copy it, or save it as .txt or
  as a coloured HTML page.
- **Effects:** add effects before the dither (to shape the image) and after
  it (to treat the result), in the inspector's Effects tab: adjust,
  blur, sharpen, grain, tint, bloom, vignette, chromatic split, scanlines and
  more. Full undo and redo.
- **Your own palettes:** pick from built-in palettes (including PICO-8 and
  web-safe), make one from your image in a click, or import a .gpl, .pal,
  .hex or Paint.NET palette file. Save any palette as .gpl.
- **Full-size export:** save at your image's own resolution (up to 8,192 px);
  patterns and effects keep their proportions.
- **Batch export:** apply one look to a whole folder of images, at preview
  size or full size.
- **Private:** your images never leave your device. Everything runs in the browser.
- **Shareable:** the link always holds your current settings. Send it and
  others get the exact look (on their own image). Save and load preset files too.
- **Installable and offline:** install it as an app; it keeps working offline.
- **Explicit colour:** choose sRGB or linear-light diffusion, and sRGB or
  perceptual (OKLab) colour matching.

## Algorithms so far

| Family | Algorithms |
|---|---|
| Basic | None (effects only), Threshold, Nearest colour |
| Error diffusion | Floyd–Steinberg, Atkinson, Burkes, Jarvis–Judice–Ninke, Stucki, Sierra, Two-row Sierra, Sierra Lite, Stevenson–Arce, Riemersma |
| Ordered | Bayer (2×2 to 16×16), Blue noise (void-and-cluster), White noise |
| Halftone | Halftone (round, diamond, square or line dots), CMYK halftone |
| Line screens | Wave lines, Rings, Spiral, Engraving |
| Pattern | Crosshatch, Contours, Shape grid, Voronoi cells |
| Polygon | Hexagons, Triangles |
| Glitch | Streak, Slip |
| Text | ASCII (shape-matched, six character sets or your own), Braille |

## Develop

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # start the web app at http://localhost:5173
npm test           # run the core test suite
npm run typecheck  # type-check every package
npm run build      # production build of the web app
npm run preview    # serve the production build (tests offline mode)
node scripts/make-icons.mjs   # regenerate the app icons
```

Pushing to `main` on GitHub runs CI and deploys the app to GitHub Pages
(enable Pages with "GitHub Actions" as the source in the repo settings).

## Layout

```
packages/core   pure TypeScript algorithms, no DOM (runs in a worker or Node)
apps/web        React + Vite app; runs core in a Web Worker
docs/           design notes
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md),
especially the clean-room rules, before adding an algorithm.

## License

Dither Dally is [MIT](LICENSE) licensed.

It uses these libraries, under their own licences:

- [React](https://react.dev) (MIT)
- [mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0), for video
  decoding, encoding and MP4 files. Used unmodified; its source is available
  from the project's repository.
- [Inter](https://rsms.me/inter/) via Fontsource (SIL Open Font License 1.1)
