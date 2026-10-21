import { decodeProjectHeader, encodeProjectHeader, projectHeaderLength, PROJECT_PREFIX_BYTES, type Preset } from "@dither-dally/core";

/**
 * Projects saved in this browser (IndexedDB): what's needed to reopen your
 * work, never uploaded anywhere. Two stores, so listing recent projects
 * doesn't load every saved image or video:
 * - "projects": name, settings, thumbnail and dates;
 * - "sources": the original file, stored once when the project starts.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** MIME type of the source, to tell images from videos. */
  sourceType: string;
  thumbnail: Blob | null;
}

interface ProjectRecord extends ProjectSummary {
  preset: Preset;
  sourceName: string;
}

const DB_NAME = "dither-dally";
const DB_VERSION = 1;

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore("projects", { keyPath: "id" });
      request.result.createObjectStore("sources");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Storage is busy in another tab."));
  });
  // A failed open (private windows, blocked storage) can be retried later.
  db.catch(() => (db = null));
  return db;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Saving was interrupted."));
  });
}

let askedToPersist = false;

export const projectStore = {
  /** Whether projects can be saved here (not in some private windows). */
  async available(): Promise<boolean> {
    try {
      await open();
      return true;
    } catch {
      return false;
    }
  },

  /** Most recently changed first. */
  async list(): Promise<ProjectSummary[]> {
    const tx = (await open()).transaction("projects");
    const all = await done(tx.objectStore("projects").getAll() as IDBRequest<ProjectRecord[]>);
    return all
      .map(({ id, name, createdAt, updatedAt, sourceType, thumbnail }) => ({ id, name, createdAt, updatedAt, sourceType, thumbnail }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** Starts a project for a newly opened file. Resolves with its id. */
  async create(name: string, preset: Preset, source: File): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const record: ProjectRecord = { id, name, preset, createdAt: now, updatedAt: now, sourceType: source.type, sourceName: source.name, thumbnail: null };
    const tx = (await open()).transaction(["projects", "sources"], "readwrite");
    tx.objectStore("sources").put(source, id);
    tx.objectStore("projects").put(record);
    await finished(tx);
    // Ask once for storage the browser won't clear under pressure; it may say no, which is fine.
    if (!askedToPersist) {
      askedToPersist = true;
      void navigator.storage?.persist?.().catch(() => {});
    }
    return id;
  },

  /** Saves new settings (and optionally a thumbnail) for a project. */
  async update(id: string, changes: { preset?: Preset; thumbnail?: Blob }): Promise<void> {
    const tx = (await open()).transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    const record = await done(store.get(id) as IDBRequest<ProjectRecord | undefined>);
    if (!record) return; // removed meanwhile
    store.put({ ...record, ...changes, updatedAt: Date.now() });
    await finished(tx);
  },

  /** The settings and source file to reopen a project. */
  async load(id: string): Promise<{ name: string; preset: Preset; file: File }> {
    const tx = (await open()).transaction(["projects", "sources"]);
    const [record, blob] = await Promise.all([
      done(tx.objectStore("projects").get(id) as IDBRequest<ProjectRecord | undefined>),
      done(tx.objectStore("sources").get(id) as IDBRequest<Blob | undefined>),
    ]);
    if (!record || !blob) throw new Error("This project is no longer saved in this browser.");
    return { name: record.name, preset: record.preset, file: new File([blob], record.sourceName, { type: record.sourceType }) };
  },

  async remove(id: string): Promise<void> {
    const tx = (await open()).transaction(["projects", "sources"], "readwrite");
    tx.objectStore("projects").delete(id);
    tx.objectStore("sources").delete(id);
    await finished(tx);
  },
};

/** A project file (.dally) for the current work: header, then the source file as is. */
export function projectFileBlob(name: string, preset: Preset, source: File): Blob {
  const header = encodeProjectHeader({ name, preset, source: { name: source.name, type: source.type } });
  return new Blob([header as BlobPart, source], { type: "application/octet-stream" });
}

/** Reads a project file without copying its (possibly large) source into memory. */
export async function readProjectFile(file: File): Promise<{ name: string; preset: Preset; warnings: string[]; source: File }> {
  const prefix = new Uint8Array(await file.slice(0, PROJECT_PREFIX_BYTES).arrayBuffer());
  const length = projectHeaderLength(prefix);
  const header = decodeProjectHeader(new Uint8Array(await file.slice(0, length).arrayBuffer()));
  const source = new File([file.slice(header.sourceOffset)], header.source.name, { type: header.source.type });
  if (source.size === 0) throw new Error("This project file is missing its image.");
  return { name: header.name, preset: header.preset, warnings: header.warnings, source };
}

/** A small PNG of the result for the Recent list. */
export async function thumbnailBlob(image: ImageData, maxSide = 160): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const full = new OffscreenCanvas(image.width, image.height);
  full.getContext("2d")!.putImageData(image, 0, 0);
  const small = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const ctx = small.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, small.width, small.height);
  return small.convertToBlob({ type: "image/png" });
}
