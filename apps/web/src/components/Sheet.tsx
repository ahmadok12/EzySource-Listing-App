import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Sheet.css";

type Props = {
  title: string;
  children: ReactNode;
  /** Called on Escape. Tapping outside does nothing, so work isn't lost by accident (specs/04). */
  onClose: () => void;
};

/** Floating glass bottom sheet over a scrim (specs/01 "Bottom sheet"). */
export function Sheet({ title, children, onClose }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rendered at the end of the page so it always sits above the app bar and bottom navigation.
  return createPortal(
    <div className="sheet__scrim">
      <div ref={ref} className="sheet glass" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="page__row-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
