import type { ButtonHTMLAttributes } from "react";
import "./Button.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", className, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={["button", `button--${variant}`, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
