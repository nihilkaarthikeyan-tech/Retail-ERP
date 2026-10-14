// Copyright (c) 2026, Rademics. All rights reserved.
import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "link";
  size?: "normal" | "small";
  /** Shows a working state and disables the button. */
  busy?: boolean;
}

export function Button({
  variant = "secondary",
  size = "normal",
  busy = false,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, size === "small" ? "btn-small" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? "Please wait…" : children}
    </button>
  );
}
