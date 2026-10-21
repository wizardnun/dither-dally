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
  /** When the settings last changed. */
  updatedAt: number;
  /** When it was last opened (older records may not have one). */
  openedAt?: number;
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

  /** Most recently edited or opened first. */
  async list(): Promise<ProjectSummary[]> {
    const tx = (await open()).transaction("projects");
    const all = await done(tx.objectStore("projects").getAll() as IDBRequest<ProjectRecord[]>);
    return all
      .map(({ id, name, createdAt, updatedAt, openedAt, sourceType, thumbnail }) => ({ id, name, createdAt, updatedAt, openedAt, sourceType, thumbnail }))
      .sort((a, b) => Math.max(b.updatedAt, b.openedAt ?? 0) - Math.max(a.updatedAt, a.openedAt ?? 0));
  },

  /** Starts a project for a newly opened file (keeping `id` when it comes from a project file). Resolves with its id. */
  async create(name: string, preset: Preset, source: File, id: string = crypto.randomUUID()): Promise<string> {
    const now = Date.now();
    const record: ProjectRecord = { id, name, preset, createdAt: now, updatedAt: now, openedAt: now, sourceType: source.type, sourceName: source.name, thumbnail: null };
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

  /**
   * Saves settings and/or a thumbnail. The edit time only moves when the
   * settings really changed, so it can be compared with a project file's.
   */
  async update(id: string, changes: { preset?: Preset; thumbnail?: Blob }): Promise<void> {
    const tx = (await open()).transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    const record = await done(store.get(id) as IDBRequest<ProjectRecord | undefined>);
    if (!record) return; // removed meanwhile
    const edited = changes.preset !== undefined && !sameSettings(record.preset, changes.preset);
    store.put({ ...record, ...changes, updatedAt: edited ? Date.now() : record.updatedAt });
    await finished(tx);
  },

  /** Marks a project as just opened, moving it to the top of Recent. */
  async touch(id: string): Promise<void> {
    const tx = (await open()).transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    const record = await done(store.get(id) as IDBRequest<ProjectRecord | undefined>);
    if (record) store.put({ ...record, openedAt: Date.now() });
    await finished(tx);
  },

  /** A project's details without its source, or null if it isn't saved here. */
  async get(id: string): Promise<(ProjectSummary & { preset: Preset }) | null> {
    const tx = (await open()).transaction("projects");
    const record = await done(tx.objectStore("projects").get(id) as IDBRequest<ProjectRecord | undefined>);
    return record ?? null;
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
export function projectFileBlob(name: string, preset: Preset, source: File, id?: string): Blob {
  const header = encodeProjectHeader({ name, preset, source: { name: source.name, type: source.type }, id, savedAt: Date.now() });
  return new Blob([header as BlobPart, source], { type: "application/octet-stream" });
}

/** Reads a project file without copying its (possibly large) source into memory. */
export interface ImportedProject {
  name: string;
  preset: Preset;
  warnings: string[];
  source: File;
  id?: string;
  savedAt?: number;
}

export async function readProjectFile(file: File): Promise<ImportedProject> {
  const prefix = new Uint8Array(await file.slice(0, PROJECT_PREFIX_BYTES).arrayBuffer());
  const length = projectHeaderLength(prefix);
  const header = decodeProjectHeader(new Uint8Array(await file.slice(0, length).arrayBuffer()));
  const source = new File([file.slice(header.sourceOffset)], header.source.name, { type: header.source.type });
  if (source.size === 0) throw new Error("This project file is missing its image.");
  return { name: header.name, preset: header.preset, warnings: header.warnings, source, id: header.id, savedAt: header.savedAt };
}

/** Whether two sets of settings are the same, whatever order their keys were written in. */
export function sameSettings(a: Preset, b: Preset): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
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
