import { useId, type InputHTMLAttributes } from "react";
import "./TextField.css";

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string };

export function TextField({ label, hint, id, ...rest }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field__input"
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      {hint ? (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
