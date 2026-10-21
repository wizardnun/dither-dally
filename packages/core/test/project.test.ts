import { describe, expect, it } from "vitest";
import { defaultPreset, effectLayer, PresetError } from "../src/preset.ts";
import {
  decodeProjectHeader,
  encodeProjectHeader,
  packProject,
  projectHeaderLength,
  PROJECT_PREFIX_BYTES,
  ProjectError,
  unpackProject,
} from "../src/project.ts";

const preset = { ...defaultPreset("halftone"), layers: [effectLayer("blur"), ...defaultPreset("halftone").layers], seed: 42 };
const info = { name: "Beach sunset", preset, source: { name: "beach.jpg", type: "image/jpeg" } };
const source = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) & 255);

describe("project files", () => {
  it("round-trips the name, settings and source bytes", () => {
    const back = unpackProject(packProject(info, source));
    expect(back.name).toBe("Beach sunset");
    expect(back.preset).toEqual(preset);
    expect(back.source).toEqual({ name: "beach.jpg", type: "image/jpeg" });
    expect(Array.from(back.sourceBytes)).toEqual(Array.from(source));
    expect(back.warnings).toEqual([]);
  });

  it("lets the header be read on its own, so the source can stay on disk", () => {
    const file = packProject(info, source);
    const length = projectHeaderLength(file.subarray(0, PROJECT_PREFIX_BYTES));
    expect(length).toBe(encodeProjectHeader(info).length);
    const header = decodeProjectHeader(file.subarray(0, length));
    expect(header.sourceOffset).toBe(length);
    expect(file.length - header.sourceOffset).toBe(source.length);
  });

  it("rejects other files, damage and newer versions with clear messages", () => {
    expect(() => unpackProject(new TextEncoder().encode('{"version":2}'))).toThrow("isn't a Dither Dally project file");
    const file = packProject(info, source);
    expect(() => unpackProject(file.subarray(0, 40))).toThrow("incomplete");
    const newer = file.slice();
    new DataView(newer.buffer).setUint32(8, 99, true);
    expect(() => unpackProject(newer)).toThrow("newer version");
    const garbled = file.slice();
    garbled[PROJECT_PREFIX_BYTES] = 0x7b + 1; // break the JSON
    expect(() => unpackProject(garbled)).toThrow(ProjectError);
    expect(() => unpackProject(encodeProjectHeader(info))).toThrow("missing its image");
  });

  it("only accepts image or video sources", () => {
    const bad = packProject({ ...info, source: { name: "notes.txt", type: "text/plain" } }, source);
    expect(() => unpackProject(bad)).toThrow("doesn't contain an image or video");
  });

  it("reads settings like a preset: adjusts what it can and rejects what it can't", () => {
    const layers = preset.layers.map((l) => (l.kind === "effect" ? { ...l, params: { ...l.params, sparkle: 3 } } : l));
    const odd = packProject({ ...info, preset: { ...preset, pixelSize: 999, layers } }, source);
    const back = unpackProject(odd);
    expect(back.preset.pixelSize).toBeLessThan(999);
    expect(back.warnings).toContain('Ignored unknown setting "sparkle".');
    const broken = packProject({ ...info, preset: { version: 1234 } as never }, source);
    expect(() => unpackProject(broken)).toThrow(PresetError);
  });

  it("falls back to the source name when the project has none", () => {
    const back = unpackProject(packProject({ ...info, name: "  " }, source));
    expect(back.name).toBe("beach");
  });

  it("carries the project's id and save time, and ignores bad ones", () => {
    const back = unpackProject(packProject({ ...info, id: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", savedAt: 1792557769872 }, source));
    expect(back.id).toBe("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
    expect(back.savedAt).toBe(1792557769872);
    const odd = unpackProject(packProject({ ...info, id: "../../etc", savedAt: -5 }, source));
    expect(odd.id).toBeUndefined();
    expect(odd.savedAt).toBeUndefined();
    // Files from before ids were saved still open.
    expect(unpackProject(packProject(info, source)).id).toBeUndefined();
  });
});
