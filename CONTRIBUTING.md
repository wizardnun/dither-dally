# Contributing to Dither Dally

Thanks for helping. A few things to know first.

## Clean-room rules

Dither Dally is MIT-licensed and must stay free of anyone else's proprietary
work. When you contribute:

- **Don't copy** code, UI text, descriptions, palette data or effect names from
  closed-source dithering apps, and don't decompile or port from their files.
- **Do** implement published algorithms from the original papers or from
  widely documented kernels, and cite the source in the algorithm's
  `reference` field.
- **Original effects** should be described in your own words in the pull
  request (what it looks like and how it works) and get an original name.
- **Palettes** must be your own, a standard/public set, or clearly licensed for
  redistribution. Note the source in the palette file.

If you're unsure whether something is OK, open an issue and ask first.

## Adding an algorithm

1. Create a module in the right family folder under `packages/core/src/`.
2. Export an `AlgorithmDefinition` with an `id`, `name`, `family`, `summary`,
   `controls` and `run`.
3. Register it in `packages/core/src/registry.ts`.
4. Add tests in `packages/core/test/`: at least the palette-only property and
   a golden snapshot.

The web UI picks it up automatically from the registry.

## Development

```sh
npm install
npm test
npm run typecheck
npm run dev
```
