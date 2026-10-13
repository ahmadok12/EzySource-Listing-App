import { useId, type TextareaHTMLAttributes } from "react";
import "./TextField.css";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string };

export function TextArea({ label, hint, id, ...rest }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <textarea
        id={inputId}
        className="field__input field__input--area"
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
