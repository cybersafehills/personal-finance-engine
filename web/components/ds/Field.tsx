import { useId } from "react";

// The OneLedger form-field primitive: one consistent structure for
// label + optional help text + optional error, with the accessibility
// relationships wired up once (master prompt section 14 / assessment
// section 6.1). Wrap any single control - a raw <input>, a <select>, the
// <CurrencyInput> below, a custom combobox - and render it via the
// child render-prop, spreading the props it hands you onto the control:
//
//   <Field label="Email" help="We never share it." error={errors.email}>
//     {(p) => <input type="email" autoComplete="email" {...p} />}
//   </Field>
//
// The render-prop supplies `id`, `aria-describedby` (help and/or error),
// `aria-invalid`, and `aria-required` so the control is announced
// correctly by a screen reader without every call site re-deriving them.

export type FieldControlProps = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
};

export function Field({
  label,
  help,
  error,
  required = false,
  /** Hide the visual <label> but keep it for assistive tech. */
  hideLabel = false,
  className,
  children,
}: {
  label: string;
  help?: string;
  error?: string | null;
  required?: boolean;
  hideLabel?: boolean;
  className?: string;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className={hideLabel
          ? "sr-only"
          : "text-sm font-medium text-text-secondary"}
      >
        {label}
        {required && (
          <span className="text-attention" aria-hidden="true">{" *"}</span>
        )}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}

      {help && !error && (
        <p id={helpId} className="text-xs text-text-muted">{help}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
