import { ExportIcon, PhotoIcon, ShareIcon, SideBySideIcon, SidebarLeftIcon, SidebarRightIcon, SplitIcon, SquareIcon } from "./icons.tsx";
import { Segmented } from "./ui.tsx";
import type { CompareMode } from "./Viewer.tsx";

interface Props {
  title: string;
  subtitle: string;
  showBrowser: boolean;
  onToggleBrowser: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  mode: CompareMode;
  onMode: (m: CompareMode) => void;
  onOpen: () => void;
  onShare: () => void;
  onExport: () => void;
  canExport: boolean;
}

export function Toolbar(p: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className="tool"
          aria-pressed={p.showBrowser}
          aria-label="Show algorithm browser"
          title="Algorithm browser"
          onClick={p.onToggleBrowser}
        >
          <SidebarLeftIcon />
        </button>
        <button type="button" className="tool" aria-label="Open image" title="Open image (Ctrl O)" onClick={p.onOpen}>
          <PhotoIcon />
        </button>
      </div>

      <div className="doc-title">
        <span className="doc-name">{p.title}</span>
        <span className="doc-sub">{p.subtitle}</span>
      </div>

      <div className="toolbar-group">
        <Segmented<CompareMode>
          label="Compare"
          iconOnly
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: "split", label: "Split compare", icon: <SplitIcon size={16} /> },
            { value: "side", label: "Side by side", icon: <SideBySideIcon size={16} /> },
            { value: "result", label: "Result only", icon: <SquareIcon size={16} /> },
          ]}
        />
        <button type="button" className="tool" aria-label="Copy link to these settings" title="Copy link to these settings" onClick={p.onShare}>
          <ShareIcon />
        </button>
        <button type="button" className="tool" aria-label="Export PNG" title="Export PNG (Ctrl E)" disabled={!p.canExport} onClick={p.onExport}>
          <ExportIcon />
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={p.showInspector}
          aria-label="Show inspector"
          title="Inspector"
          onClick={p.onToggleInspector}
        >
          <SidebarRightIcon />
        </button>
      </div>
    </header>
  );
}
