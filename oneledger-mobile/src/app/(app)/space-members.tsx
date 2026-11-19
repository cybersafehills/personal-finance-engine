import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Share, View } from "react-native";

import { inviteMember, removeMember, revokeInvite, setMemberRole } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { HouseholdSharing } from "@/features/spaces/HouseholdSharing";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import {
  canEditRow,
  canManageInvites,
  INVITE_ROLE_OPTIONS,
  inviteExpiryLabel,
  inviteOutcomeText,
  isPlausibleEmail,
  memberLabel,
  roleLabel,
  ROLE_OPTIONS,
  type InviteRole,
  type Member,
  type MemberRole,
  type PendingInvite,
} from "@/features/spaces/members";
import { getMemberNames, getMembers, getPendingInvites } from "@/features/spaces/members-queries";
import { kindLabel, type Space } from "@/features/spaces/spaces";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

// Space & members for the Space you are viewing (web: Settings > Spaces &
// members). Reads are plain RLS reads; every write goes through the server
// (second factor required) and names this Space explicitly. The database
// decides who may do what: owners change roles and remove people, owners and
// admins invite. The controls follow that, so nothing is offered that the
// database would refuse.
export default function SpaceMembers() {
  const { active } = useActiveSpace();

  if (!active || active.kind === "personal") {
    return (
      <Screen>
        <ScreenHeader title="Space & members" subtitle="Personal is yours alone. Create a shared Space to collaborate." />
        <EmptyState
          variant="setup"
          title="Nobody else is in your Personal Space"
          description="Start a household or an organization, then invite the people you want in it."
          action={<Button label="Create a Space" onPress={() => router.push("/create-space")} />}
        />
      </Screen>
    );
  }
  return <SpaceMembersFor key={active.id} space={active} />;
}

async function loadAll(workspaceId: string) {
  const [members, names, invites] = await Promise.all([
    getMembers(workspaceId),
    getMemberNames(workspaceId),
    getPendingInvites(workspaceId).catch(() => [] as PendingInvite[]),
  ]);
  return { members, names, invites };
}

function SpaceMembersFor({ space: sp }: { space: Space }) {
  const load = useCallback(() => loadAll(sp.id), [sp.id]);
  const { data, loading, error, refresh } = useQuery(load);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Your role as the Space's own member list says it (the switcher's copy can be stale).
  const myRole = data?.members.find((m) => m.isSelf)?.role ?? sp.role;

  const act = useCallback(
    async (run: () => Promise<{ ok: boolean; message?: string }>) => {
      setBusy(true);
      setMessage(null);
      const result = await run();
      setBusy(false);
      if (!result.ok) setMessage(result.message ?? "Couldn't do that. Try again.");
      refresh();
      return result.ok;
    },
    [refresh],
  );

  return (
    <Screen>
      <ScreenHeader title={sp.name} subtitle={`${kindLabel(sp.kind)} · members and invites`} />

      {sp.kind === "household" ? (
        <>
          <HowHouseholdsWork />
          <HouseholdSharing space={{ ...sp, role: myRole }} />
        </>
      ) : null}

      {message ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : error && !data ? (
        <EmptyState
          title={error}
          action={<Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : data ? (
        <>
          {data.members.map((member) => (
            <MemberRow
              key={member.membershipId}
              member={member}
              label={memberLabel(member, data.names)}
              editable={canEditRow(myRole, member)}
              busy={busy}
              onRole={(role) => act(() => setMemberRole(sp.id, member.membershipId, role))}
              onRemove={() => act(() => removeMember(sp.id, member.membershipId))}
            />
          ))}

          {canManageInvites(myRole) ? (
            <>
              {data.invites.length > 0 ? (
                <View style={{ gap: space[2] }}>
                  <Text variant="bodyStrong">Pending invites</Text>
                  {data.invites.map((invite) => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      busy={busy}
                      onCancel={() => act(() => revokeInvite(sp.id, invite.id))}
                    />
                  ))}
                </View>
              ) : null}
              <InviteForm spaceName={sp.name} workspaceId={sp.id} onSent={refresh} />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function HowHouseholdsWork() {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: space[2] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: "center" }}
      >
        <Text variant="bodyStrong">How households work</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label" color="textSecondary">
            Everyone here keeps their own OneLedger account and their own private transactions. Nothing is shared automatically.
          </Text>
          <Text variant="label" color="textSecondary">
            You choose whether to share a wallet’s transactions and balance with this household.
          </Text>
          <Text variant="label" color="textSecondary">
            Every shared transaction can be marked as one person’s spending, split between people, or shared by the household. This only changes how the household’s reports count it; it never moves money.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function RoleChips<R extends string>({
  options,
  value,
  onPick,
  disabled,
}: {
  options: readonly { value: R; label: string }[];
  value: R | null;
  onPick(role: R): void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={o.label}
            disabled={disabled}
            onPress={() => onPick(o.value)}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              justifyContent: "center",
              paddingHorizontal: space[3],
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.borderStrong,
              backgroundColor: selected ? colors.surface : colors.background,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <Text variant="label" color={selected ? "accent" : "textSecondary"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MemberRow({
  member,
  label,
  editable,
  busy,
  onRole,
  onRemove,
}: {
  member: Member;
  label: string;
  editable: boolean;
  busy: boolean;
  onRole(role: MemberRole): Promise<boolean>;
  onRemove(): Promise<boolean>;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmOwner, setConfirmOwner] = useState(false);

  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Text variant="bodyStrong">{label}</Text>
        <Badge variant="neutral">{roleLabel(member.role)}</Badge>
        {member.status === "invited" ? <Badge variant="neutral">Invited</Badge> : null}
        {member.status === "suspended" ? <Badge variant="attention">Suspended</Badge> : null}
      </View>
      <Text variant="caption" color="textMuted">
        {member.joinedAt ? `Joined ${formatDateTime(member.joinedAt)}` : "Not yet joined"}
      </Text>

      {editable ? (
        <>
          <RoleChips
            options={ROLE_OPTIONS}
            value={member.role}
            disabled={busy}
            onPick={(role) => {
              if (role === member.role) return;
              if (role === "owner") setConfirmOwner(true);
              else void onRole(role);
            }}
          />
          {confirmOwner ? (
            <View style={{ gap: space[2] }}>
              <Text variant="label" color="textSecondary">
                Make {label} an owner? Owners can change roles and remove anyone.
              </Text>
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <Button
                  label="Make owner"
                  disabled={busy}
                  onPress={async () => {
                    setConfirmOwner(false);
                    await onRole("owner");
                  }}
                />
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmOwner(false)} />
              </View>
            </View>
          ) : null}

          {!confirmRemove ? (
            <View style={{ flexDirection: "row" }}>
              <Button label="Remove" variant="ghost" onPress={() => setConfirmRemove(true)} />
            </View>
          ) : (
            <View style={{ gap: space[2] }}>
              <Text variant="label" color="textSecondary">
                Remove {label} from this Space?
              </Text>
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <Button
                  label="Yes, remove"
                  disabled={busy}
                  onPress={async () => {
                    const ok = await onRemove();
                    if (!ok) setConfirmRemove(false);
                  }}
                />
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmRemove(false)} />
              </View>
            </View>
          )}
        </>
      ) : null}
    </Card>
  );
}

function InviteRow({
  invite,
  busy,
  onCancel,
}: {
  invite: PendingInvite;
  busy: boolean;
  onCancel(): Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card style={{ gap: space[1] }}>
      <Text variant="bodyStrong">{invite.email}</Text>
      <Text variant="caption" color="textMuted">
        {`${roleLabel(invite.role)} · ${inviteExpiryLabel(invite, formatDateTime)}`}
      </Text>
      {!confirming ? (
        <View style={{ flexDirection: "row" }}>
          <Button label="Cancel invite" variant="ghost" onPress={() => setConfirming(true)} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button
            label="Yes, cancel it"
            disabled={busy}
            onPress={async () => {
              const ok = await onCancel();
              if (!ok) setConfirming(false);
            }}
          />
          <Button label="Keep" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      )}
    </Card>
  );
}

function InviteForm({
  spaceName,
  workspaceId,
  onSent,
}: {
  spaceName: string;
  workspaceId: string;
  onSent(): void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The link exists only in this state: never stored, gone when dismissed.
  const [sent, setSent] = useState<{ email: string; emailSent: boolean; link: string | null } | null>(null);

  async function submit() {
    if (!isPlausibleEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setSending(true);
    setError(null);
    const result = await inviteMember(workspaceId, email.trim(), role);
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent({ email: email.trim(), emailSent: result.emailSent, link: result.link });
    setEmail("");
    onSent();
  }

  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="bodyStrong">Invite someone</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error) setError(null);
        }}
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={error ?? undefined}
        editable={!sending}
      />
      <RoleChips<InviteRole> options={INVITE_ROLE_OPTIONS} value={role} onPick={setRole} disabled={sending} />
      <Button label="Send invite" fullWidth loading={sending} onPress={submit} />

      {sent ? (
        <View style={{ gap: space[2] }} accessibilityLiveRegion="polite">
          <Text variant="label" color="textSecondary">
            {inviteOutcomeText(sent.email, sent.emailSent)}
          </Text>
          {sent.link ? (
            <Button
              label="Share link"
              variant="secondary"
              onPress={() => Share.share({ message: `Join ${spaceName} on OneLedger: ${sent.link}` })}
            />
          ) : null}
          <Button label="Done" variant="ghost" onPress={() => setSent(null)} />
        </View>
      ) : null}
    </Card>
  );
}
