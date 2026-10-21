import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SidebarRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
    <path d="M12.5 4v12M14.5 7h1M14.5 9.5h1" />
  </Icon>
);

export const PhotoIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
    <circle cx="7" cy="8" r="1.3" />
    <path d="M3 14l4.2-3.8 3 2.6 2.8-2.3L17 13.6" />
  </Icon>
);

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.2 10 3.8l6.5 5.4" />
    <path d="M5.2 8v7.2a1.3 1.3 0 0 0 1.3 1.3h7a1.3 1.3 0 0 0 1.3-1.3V8" />
    <path d="M8.4 16.5v-4.2h3.2v4.2" />
  </Icon>
);

export const SplitIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
    <path d="M10 2.5v15" />
    <path d="M10 4h5a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 15 16h-5z" fill="currentColor" stroke="none" opacity="0.35" />
  </Icon>
);

export const SideBySideIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="5" width="7" height="10" rx="1.8" />
    <rect x="11" y="5" width="7" height="10" rx="1.8" />
  </Icon>
);

export const SquareIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="13" height="12" rx="2.5" />
  </Icon>
);

export const ExportIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3v9.5M6.8 9.5 10 12.7l3.2-3.2" />
    <path d="M3.5 13.5v1.5A2 2 0 0 0 5.5 17h9a2 2 0 0 0 2-2v-1.5" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 5l5 5-5 5" />
  </Icon>
);

export const DiceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="3" />
    <circle cx="7.2" cy="7.2" r="0.6" fill="currentColor" />
    <circle cx="12.8" cy="12.8" r="0.6" fill="currentColor" />
    <circle cx="10" cy="10" r="0.6" fill="currentColor" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 10h10" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 10h10M10 5v10" />
  </Icon>
);

export const MoreIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <circle cx="5" cy="10" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="15" cy="10" r="1.4" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" />
    <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />
  </Icon>
);

export const DocIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 2.8h6l3.5 3.5v9.4a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 15.7V4.3a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M11.5 2.8v3.5H15" />
  </Icon>
);

export const StylesIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="6" height="6" rx="1.6" />
    <rect x="11" y="3" width="6" height="6" rx="1.6" />
    <rect x="3" y="11" width="6" height="6" rx="1.6" />
    <rect x="11" y="11" width="6" height="6" rx="1.6" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.8" cy="8.8" r="5.3" />
    <path d="m12.8 12.8 4 4" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
    <circle cx="10" cy="10" r="2.2" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 6.6C3.3 7.8 2.5 10 2.5 10s2.8 5 7.5 5c1.4 0 2.6-.4 3.6-1M8 5.3c.6-.2 1.3-.3 2-.3 4.7 0 7.5 5 7.5 5s-.6 1.1-1.7 2.3" />
    <path d="M3 3l14 14" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 10a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5 3.5 8 7 11.5" />
    <path d="M3.5 8h8a4.5 4.5 0 0 1 0 9H9" />
  </Icon>
);

export const RedoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 4.5 16.5 8 13 11.5" />
    <path d="M16.5 8h-8a4.5 4.5 0 0 0 0 9H11" />
  </Icon>
);

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1L7.4 3.7a.6.6 0 0 0-.9.5z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="4" width="3.4" height="12" rx="1" fill="currentColor" stroke="none" />
    <rect x="11.6" y="4" width="3.4" height="12" rx="1" fill="currentColor" stroke="none" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.8 6.2A1.7 1.7 0 0 1 4.5 4.5h3.3l1.7 1.7h6a1.7 1.7 0 0 1 1.7 1.7v6.4a1.7 1.7 0 0 1-1.7 1.7h-11a1.7 1.7 0 0 1-1.7-1.7z" />
  </Icon>
);
