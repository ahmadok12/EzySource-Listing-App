import { useId, type InputHTMLAttributes } from "react";
import "./TextField.css";

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | undefined };

export function TextField({ label, hint, error, id, ...rest }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field__input"
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint ? (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="field__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
