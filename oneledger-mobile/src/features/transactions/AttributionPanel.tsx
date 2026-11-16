import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { Badge, Button, Card, Text, TextField } from "@/components/ds";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

import {
  type Attribution,
  ATTRIBUTION_OPTIONS,
  AttributionError,
  type AttributionType,
  attributionSummary,
  checkSplit,
  initialSplitRows,
  memberDisplayName,
  needsAttribution,
  setAttribution,
  totalLabel,
} from "./attribution";
import type { Member } from "./detailDisplay";

// "Whose spending?" on a household transaction: shared, one member, a percentage
// split, or not sure yet. It only changes how the expense is COUNTED in household
// reports; no money moves. Saved through the database function the web uses (the
// database checks the caller's permission), so a member without permission gets
// the database's own plain refusal.
export function AttributionPanel({
  transactionId,
  current,
  members,
  selfUserId,
  onSaved,
}: {
  transactionId: string;
  current: Attribution;
  members: Member[];
  selfUserId: string | null;
  /** Called after a successful save, so the screen can refresh what depends on it. */
  onSaved?: () => void;
}) {
  // What was saved here, remembered together with the `current` it was saved
  // against. It only wins while that `current` is still the screen's data: once
  // fresh data arrives (a reload after the save, or a change made elsewhere, by
  // another member or on the web) the screen's own value is shown again, so "Change"
  // never opens from a stale one.
  const [savedAgainst, setSavedAgainst] = useState<{ base: Attribution; value: Attribution } | null>(null);
  const shown = savedAgainst && savedAgainst.base === current ? savedAgainst.value : current;

  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<AttributionType>(shown.type ?? "shared");
  const [memberId, setMemberId] = useState<string>(shown.attributedUserId ?? selfUserId ?? members[0]?.userId ?? "");
  const [rows, setRows] = useState(() => initialSplitRows(members, shown.splits));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Choosing a member or a split needs the member list; without it only the two
  // choices that name nobody are offered.
  const options = members.length > 0 ? ATTRIBUTION_OPTIONS : ATTRIBUTION_OPTIONS.filter((o) => o.value === "shared" || o.value === "unassigned");
  const check = useMemo(() => checkSplit(rows), [rows]);
  // Don't nag before anything is typed, but explain as soon as something is (an
  // unreadable entry leaves the running total at 0, so the total can't be the cue).
  const touched = rows.some((r) => r.percentText.trim() !== "");
  const canSave = !busy && (type !== "split" || check.ok) && (type !== "member" || memberId !== "");

  function open() {
    setType(shown.type ?? "shared");
    setMemberId(shown.attributedUserId ?? selfUserId ?? members[0]?.userId ?? "");
    setRows(initialSplitRows(members, shown.splits));
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (inFlight.current || !canSave) return; // one save at a time
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await setAttribution(
        transactionId,
        type === "member"
          ? { type, memberId }
          : type === "split"
            ? { type, splits: check.ok ? check.splits : [] }
            : { type },
      );
      setSavedAgainst({ base: current, value: result });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(e instanceof AttributionError ? e.message : "Something went wrong. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="caption" color="textMuted" accessibilityRole="header">
        WHOSE SPENDING
      </Text>
      <Text variant="caption" color="textMuted">
        Household reports split spending by member. This doesn&apos;t move any money. It only changes how this expense is counted.
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Text variant="bodyStrong">{attributionSummary(shown, members, selfUserId)}</Text>
        {needsAttribution(shown) ? <Badge variant="attention">Needs attribution</Badge> : null}
      </View>

      {!editing ? <Button label="Change" variant="secondary" fullWidth onPress={open} /> : null}

      {editing ? (
        <View style={{ gap: space[3], padding: space[3], borderRadius: radii.control, backgroundColor: colors.background }}>
          <Text variant="label" color="textSecondary">
            Whose spending is this?
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: type === option.value }}
              onPress={() => setType(option.value)}
              style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: MIN_TOUCH_TARGET }}
            >
              <Text variant="label" color={type === option.value ? "accent" : "textMuted"}>
                {type === option.value ? "●" : "○"}
              </Text>
              <Text variant="label">{option.label}</Text>
            </Pressable>
          ))}

          {type === "member" ? (
            <View style={{ gap: space[1] }}>
              <Text variant="caption" color="textMuted">
                Member
              </Text>
              {members.map((m) => (
                <Pressable
                  key={m.userId}
                  accessibilityRole="radio"
                  accessibilityLabel={memberDisplayName(members, m.userId, selfUserId)}
                  accessibilityState={{ selected: memberId === m.userId }}
                  onPress={() => setMemberId(m.userId)}
                  style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: MIN_TOUCH_TARGET }}
                >
                  <Text variant="label" color={memberId === m.userId ? "accent" : "textMuted"}>
                    {memberId === m.userId ? "●" : "○"}
                  </Text>
                  <Text variant="label">{memberDisplayName(members, m.userId, selfUserId)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {type === "split" ? (
            <View style={{ gap: space[2] }}>
              {rows.map((row, index) => (
                <TextField
                  key={row.userId}
                  label={`${memberDisplayName(members, row.userId, selfUserId)}'s share`}
                  value={row.percentText}
                  onChangeText={(text) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, percentText: text } : r)))}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  help="% (leave empty to leave them out)"
                  editable={!busy}
                />
              ))}
              <Text variant="label" color={check.ok ? "textMuted" : "attention"} accessibilityLiveRegion="polite">
                {totalLabel(check.totalBps)}
              </Text>
              {!check.ok && touched ? (
                <Text variant="caption" color="attention">
                  {check.message}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: space[2] }}>
            <Button label="Save" fullWidth loading={busy} disabled={!canSave} onPress={save} />
            <Button label="Cancel" variant="ghost" fullWidth disabled={busy} onPress={() => { setEditing(false); setError(null); }} />
          </View>
        </View>
      ) : null}

      {error ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
