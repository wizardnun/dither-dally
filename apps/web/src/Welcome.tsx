import { useEffect, useState } from "react";
import { DocIcon, FolderIcon, PhotoIcon } from "./icons.tsx";
import type { ProjectSummary } from "./projects.ts";
import { useObjectUrls } from "./ui.tsx";

/** How long ago, in words: "just now", "5 min ago", "yesterday", or a date. */
export function ago(time: number, now = Date.now()): string {
  const s = (now - time) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return "yesterday";
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

interface Props {
  /** Whether this browser can keep projects; null while checking. */
  available: boolean | null;
  /** The page was opened from a shared link, whose settings apply to whatever you open. */
  fromLink: boolean;
  listRecent: () => Promise<ProjectSummary[]>;
  onOpenRecent: (id: string) => void;
  onRemoveRecent: (id: string) => Promise<void>;
  onOpenFile: () => void;
  onOpenProjectFile: () => void;
  onSample: () => void;
}

/**
 * The start screen: ways to begin on the left, recent projects on the
 * right. Escape or "Try the sample image" goes straight to the editor.
 * Files can be dropped anywhere, as in the editor.
 */
export function Welcome(p: Props) {
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const thumbs = useObjectUrls();

  useEffect(() => {
    if (p.available) p.listRecent().then(setRecent, () => setRecent([]));
    else if (p.available === false) setRecent([]);
  }, [p.available]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onSample();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onSample]);

  return (
    <div className="welcome-backdrop">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <section className="welcome-start">
          <img className="welcome-icon" src="./icon.svg" alt="" width={112} height={112} />
          <h1 id="welcome-title">Dither Dally</h1>
          <p className="welcome-tagline">An open-source dithering studio. Your images never leave your device.</p>
          <div className="welcome-actions">
            <button type="button" className="welcome-action" onClick={p.onOpenFile} autoFocus>
              <PhotoIcon size={30} />
              <span>
                <strong>Open an image or video</strong>
                <span>Starts a new project. You can also drop a file here.</span>
              </span>
            </button>
            <button type="button" className="welcome-action" onClick={p.onOpenProjectFile}>
              <FolderIcon size={30} />
              <span>
                <strong>Open a project file</strong>
                <span>A .dally file saved from Dither Dally.</span>
              </span>
            </button>
            <button type="button" className="welcome-action" onClick={p.onSample}>
              <DocIcon size={30} />
              <span>
                <strong>Try the sample image</strong>
                <span>Explore the styles before you bring your own.</span>
              </span>
            </button>
          </div>
          {p.fromLink && <p className="welcome-note">This link's settings will be applied to whatever you open.</p>}
        </section>

        <section className="welcome-recent" aria-label="Recent projects">
          {recent && recent.length > 0 ? (
            <ul>
              {recent.map((r) => (
                <li key={r.id}>
                  <button type="button" className="welcome-project" onClick={() => p.onOpenRecent(r.id)}>
                    <span className="welcome-thumb" aria-hidden="true">
                      {r.thumbnail && <img src={thumbs.get(r.id, r.thumbnail)} alt="" />}
                    </span>
                    <span className="welcome-project-text">
                      <span className="welcome-project-name">{r.name}</span>
                      <span className="welcome-project-meta">
                        {r.sourceType.startsWith("video/") ? "Video · " : ""}
                        Edited {ago(r.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="recent-remove"
                    aria-label={`Remove ${r.name} from this browser`}
                    title="Remove from this browser"
                    onClick={async () => {
                      await p.onRemoveRecent(r.id);
                      setRecent((list) => list?.filter((x) => x.id !== r.id) ?? null);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="welcome-empty">
              {recent === null
                ? ""
                : p.available === false
                  ? "This browser window can't keep projects (private browsing?). Use Save project file to keep your work."
                  : "Your projects will appear here. Work saves automatically in this browser as you go."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
