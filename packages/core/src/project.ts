import { parsePreset, type Preset } from "./preset.ts";

/**
 * Project files (.dally): everything needed to reopen your work elsewhere.
 *
 * Layout: the 8 ASCII bytes "DALLYPRJ", the format version and the header
 * length (both little-endian uint32), a UTF-8 JSON header (name, settings,
 * source file name and type), then the original image or video, byte for
 * byte. The header can be read without the source, so a large video
 * project can be opened without copying the video in memory.
 */

const MAGIC = "DALLYPRJ";
export const PROJECT_VERSION = 1;
/** Bytes before the JSON header: magic, version, header length. */
export const PROJECT_PREFIX_BYTES = 16;
/** A header is a few kilobytes at most; anything bigger is a damaged file. */
const MAX_HEADER_BYTES = 4 * 1024 * 1024;

export class ProjectError extends Error {}

export interface ProjectInfo {
  name: string;
  preset: Preset;
  source: { name: string; type: string };
}

/** The bytes that come before the source file. */
export function encodeProjectHeader(info: ProjectInfo): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ name: info.name, preset: info.preset, source: info.source }));
  const out = new Uint8Array(PROJECT_PREFIX_BYTES + json.length);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  const view = new DataView(out.buffer);
  view.setUint32(8, PROJECT_VERSION, true);
  view.setUint32(12, json.length, true);
  out.set(json, PROJECT_PREFIX_BYTES);
  return out;
}

/** Reads the first PROJECT_PREFIX_BYTES of a file and returns how long the whole header is. */
export function projectHeaderLength(prefix: Uint8Array): number {
  if (prefix.length < PROJECT_PREFIX_BYTES || String.fromCharCode(...prefix.subarray(0, 8)) !== MAGIC) {
    throw new ProjectError("This isn't a Dither Dally project file.");
  }
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const version = view.getUint32(8, true);
  if (version > PROJECT_VERSION) throw new ProjectError("This project was saved by a newer version of Dither Dally. Reload the page to update.");
  if (version < 1) throw new ProjectError("This project file is damaged.");
  const length = view.getUint32(12, true);
  if (length === 0 || length > MAX_HEADER_BYTES) throw new ProjectError("This project file is damaged.");
  return PROJECT_PREFIX_BYTES + length;
}

/**
 * Parses a project header (at least projectHeaderLength bytes from the
 * start of the file). Settings are read like a preset, so older projects
 * open with sensible values; warnings say what was adjusted.
 */
export function decodeProjectHeader(bytes: Uint8Array): ProjectInfo & { warnings: string[]; sourceOffset: number } {
  const end = projectHeaderLength(bytes);
  if (bytes.length < end) throw new ProjectError("This project file is incomplete.");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(PROJECT_PREFIX_BYTES, end)));
  } catch {
    throw new ProjectError("This project file is damaged.");
  }
  if (!isRecord(json) || !isRecord(json.source)) throw new ProjectError("This project file is damaged.");
  const type = typeof json.source.type === "string" ? json.source.type : "";
  if (!/^(image|video)\//.test(type)) throw new ProjectError("This project file doesn't contain an image or video.");
  const sourceName = typeof json.source.name === "string" && json.source.name ? json.source.name : "image";
  const name = typeof json.name === "string" && json.name.trim() ? json.name.trim().slice(0, 120) : sourceName.replace(/\.[^.]+$/, "");
  const { preset, warnings } = parsePreset(json.preset);
  return { name, preset, source: { name: sourceName, type }, warnings, sourceOffset: end };
}

/** A whole project file in memory (for small sources and tests; the app streams from a Blob instead). */
export function packProject(info: ProjectInfo, source: Uint8Array): Uint8Array {
  const header = encodeProjectHeader(info);
  const out = new Uint8Array(header.length + source.length);
  out.set(header);
  out.set(source, header.length);
  return out;
}

export function unpackProject(bytes: Uint8Array): ProjectInfo & { warnings: string[]; sourceBytes: Uint8Array } {
  const header = decodeProjectHeader(bytes);
  const sourceBytes = bytes.subarray(header.sourceOffset);
  if (sourceBytes.length === 0) throw new ProjectError("This project file is missing its image.");
  const { sourceOffset: _, ...rest } = header;
  return { ...rest, sourceBytes };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
