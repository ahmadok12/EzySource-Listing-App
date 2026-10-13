import { useId, useState } from "react";
import "./ChipGroup.css";

type Option = { value: string; label: string };

type Props = {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  /** Tapping the selected chip again clears it. */
  allowClear?: boolean;
  /** Show this many chips (plus the selected one) until "More" is tapped. */
  collapseAfter?: number;
};

/** Single-choice pill chips (specs/01 "Chips"): glass when off, ink when on. */
export function ChipGroup({ label, options, value, onChange, allowClear = false, collapseAfter }: Props) {
  const labelId = useId();
  const [expanded, setExpanded] = useState(false);
  const collapsed = !expanded && collapseAfter !== undefined && options.length > collapseAfter + 1;
  const shown = collapsed
    ? options.filter((o, i) => i < collapseAfter || o.value === value)
    : options;
  return (
    <div className="chips">
      <span id={labelId} className="field__label">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="chips__list">
        {shown.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "chip chip--on" : "chip"}
              onClick={() => onChange(selected && allowClear ? "" : option.value)}
            >
              {option.label}
            </button>
          );
        })}
        {collapsed ? (
          <button type="button" className="chip chip--more" onClick={() => setExpanded(true)}>
            More ({options.length - shown.length})
          </button>
        ) : null}
      </div>
    </div>
  );
}
