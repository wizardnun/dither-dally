import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Menu widths in px, matching `.menu` and `.menu.narrow`. */
export const MENU = 280;
export const NARROW_MENU = 200;

export type MenuPosition = { top: number; left: number; anchor: HTMLElement };

/** Below `el`, aligned to its right edge (or left) and kept inside the window. */
export function menuBelow(el: HTMLElement, width = MENU, align: "left" | "right" = "right"): MenuPosition {
  const r = el.getBoundingClientRect();
  const left = align === "left" ? r.left : r.right - width;
  return { top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), anchor: el };
}

/**
 * A menu rendered at the top level, so the panel's clipping and blur don't
 * affect it. Closes on Escape or a click elsewhere.
 */
export function FloatingMenu({
  at,
  label,
  onClose,
  narrow,
  children,
}: {
  at: MenuPosition;
  label: string;
  onClose: () => void;
  narrow?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // A click on the button that opened the menu toggles it there instead.
      if (!ref.current?.contains(t) && !at.anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      className={`menu floating${narrow ? " narrow" : ""}`}
      role="menu"
      aria-label={label}
      style={{ top: at.top, left: at.left }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  onClick,
  close,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  close: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? " danger" : ""}`}
      disabled={disabled}
      onClick={() => {
        close();
        onClick();
      }}
    >
      <span className="menu-name">{children}</span>
    </button>
  );
}
