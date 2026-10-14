// Copyright (c) 2026, Rademics. All rights reserved.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldProps {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

/** Label + control + optional hint and error. The control inside must use the same `id`. */
export function Field({ id, label, error, hint, required, children }: FieldProps) {
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { id: string; label: ReactNode; error?: string | null; hint?: ReactNode };

/** Convenience: a Field wrapping a single <input>. */
export function TextInput({ id, label, error, hint, required, className, ...rest }: InputProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <input
        id={id}
        className={["input", className ?? ""].filter(Boolean).join(" ")}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
};

export function SelectInput({ id, label, error, hint, required, className, children, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <select
        id={id}
        className={["input", className ?? ""].filter(Boolean).join(" ")}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
};

export function TextareaInput({ id, label, error, hint, required, className, ...rest }: TextareaProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <textarea
        id={id}
        className={["input", className ?? ""].filter(Boolean).join(" ")}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
    </Field>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  label: ReactNode;
  description?: ReactNode;
}

/** A checkbox (or radio with type override) with its label to the right. */
export function CheckInput({ id, label, description, className, ...rest }: CheckboxProps) {
  return (
    <div className={["check", className ?? ""].filter(Boolean).join(" ")}>
      <input id={id} type="checkbox" {...rest} />
      <label htmlFor={id}>
        <span>{label}</span>
        {description ? <span className="check-description">{description}</span> : null}
      </label>
    </div>
  );
}

export function RadioInput({ id, label, description, className, ...rest }: CheckboxProps) {
  return (
    <div className={["check", className ?? ""].filter(Boolean).join(" ")}>
      <input id={id} type="radio" {...rest} />
      <label htmlFor={id}>
        <span>{label}</span>
        {description ? <span className="check-description">{description}</span> : null}
      </label>
    </div>
  );
}
