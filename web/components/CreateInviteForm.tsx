"use client";

import { useState, useTransition } from "react";
import { createInvite } from "../app/settings/workspace/actions";
import { RevealedSecret } from "./RevealedSecret";

const ROLE_OPTIONS = [
  { value: "member", label: "Member — can add accounts and categorize transactions" },
  { value: "admin", label: "Admin — same as Member, for now" },
  { value: "viewer", label: "Viewer — read-only" },
] as const;

export function CreateInviteForm({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ link: string; emailSent: boolean } | null>(null);

  if (revealed) {
    return (
      <RevealedSecret
        secret={revealed.link}
        onDismiss={() => {
          setRevealed(null);
          setOpen(false);
          setEmail("");
        }}
        instructions={
          <>
            <p className="font-medium text-text-primary">
              {revealed.emailSent ? "Also sent by email" : "Send this link"}
            </p>
            <p className="mt-1">
              {revealed.emailSent
                ? `We emailed this link to ${email}. `
                : "We couldn't send this by email — share it yourself. "}
              Anyone with this link can join the workspace at the role you
              picked, whether or not they sign up with the email address
              above. It expires in 7 days.
            </p>
          </>
        }
      />
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        Invite someone
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setErrorMessage(null);
        startTransition(async () => {
          const result = await createInvite(
            workspaceId,
            email,
            role,
            window.location.origin,
            workspaceName,
          );
          if (result.ok) {
            setRevealed({ link: result.link, emailSent: result.emailSent });
          } else {
            setErrorMessage(result.error);
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          required
          autoFocus
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Role</span>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create invite"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
