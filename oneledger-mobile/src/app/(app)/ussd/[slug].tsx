import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Share, View } from "react-native";

import { Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { buildTelHref, fillUssdTemplate, type ParamSpec } from "@/features/ussd/capability";
import { getFavouriteIds, getServiceCodeBySlug, reportServiceCode, REPORT_TYPES, toggleFavourite, type ReportType } from "@/features/ussd/queries";
import { firstSentence } from "@/features/ussd/text";
import { CATEGORY_LABELS } from "@/features/ussd/types";
import { useQuery } from "@/hooks/useQuery";
import { colors, hitSlopFor, radii, space } from "@/theme/tokens";

// One service code, built around using it: what it is, the code (filled in when it
// needs your details) and a button that opens your dialer with it. Everything else
// (how it works, the source, reporting a mistake) sits below, in "About this code".
// It never dials by itself: only your tap opens the dialer, and you approve the
// request with your provider on your own phone.
export default function UssdCode() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const load = useCallback(async () => {
    if (!slug) return null;
    const [code, favouriteIds] = await Promise.all([getServiceCodeBySlug(slug), getFavouriteIds()]);
    return code ? { code, favourite: favouriteIds.has(code.id) } : null;
  }, [slug]);
  const { data, loading, error, refresh } = useQuery(load);

  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const specs: ParamSpec[] = useMemo(
    () =>
      (data?.code.parameters ?? []).map((p) => ({
        key: p.key,
        kind: p.kind,
        required: p.required,
        formatRegex: p.formatRegex,
        minLength: p.minLength,
        maxLength: p.maxLength,
      })),
    [data],
  );

  // The native header just says what this is; the code's own name is the heading below.
  const header = <ScreenHeader title="USSD code" />;

  if (!data) {
    return (
      <Screen>
        {header}
        {loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            title={error ?? "We couldn't find that service"}
            action={error ? <Button label="Try again" variant="secondary" onPress={refresh} /> : undefined}
          />
        )}
      </Screen>
    );
  }

  const { code, favourite } = data;
  const needsDetails = code.acceptsParameters && code.parameters.length > 0;
  const filled = code.acceptsParameters
    ? fillUssdTemplate(code.template, values, specs)
    : ({ ok: true, display: code.template, dial: code.template } as const);
  const dialString = filled.ok ? filled.dial : null;
  const touched = Object.values(values).some((v) => v.trim() !== "");
  const deprecated = code.state === "deprecated";
  const unavailable = code.state === "temporarily_unavailable";
  const blocked = unavailable;
  const summary = firstSentence(code.description);

  async function onDial() {
    if (!dialString) return;
    setNote(null);
    try {
      await Linking.openURL(buildTelHref(dialString));
    } catch {
      setNote("Couldn't open the dialer. Share or copy the code and dial it yourself.");
    }
  }

  async function onShare() {
    if (!dialString) return;
    setNote(null);
    try {
      await Share.share({ message: dialString });
    } catch {
      setNote("Couldn't open the share sheet. Select the code and copy it.");
    }
  }

  async function onStar() {
    try {
      await toggleFavourite(code.id, favourite);
    } catch {
      setNote("Could not update your favourites.");
    }
    refresh();
  }

  return (
    <Screen>
      {header}

      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            {code.name}
          </Text>
          <Text variant="label" color="textMuted">
            {`${code.provider} · ${CATEGORY_LABELS[code.category] ?? ""}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={favourite ? "Remove from favourites" : "Add to favourites"}
          accessibilityState={{ selected: favourite }}
          onPress={onStar}
          hitSlop={hitSlopFor(36)}
          style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="star" size={22} color={favourite ? colors.accent : colors.textMuted} />
        </Pressable>
      </View>

      {summary ? <Text color="textSecondary">{summary}</Text> : null}

      {deprecated ? (
        <Notice tone="attention">
          This code is deprecated and may no longer work.
          {code.replacementSlug ? " Use the current one instead." : ""}
        </Notice>
      ) : null}
      {deprecated && code.replacementSlug ? (
        <Button
          label="Use the current code instead"
          variant="secondary"
          onPress={() => router.replace({ pathname: "/ussd/[slug]", params: { slug: code.replacementSlug! } })}
        />
      ) : null}
      {unavailable ? <Notice tone="attention">This service is temporarily unavailable.</Notice> : null}
      {code.riskText ? <Notice tone="attention">{code.riskText}</Notice> : null}

      {needsDetails ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            Your details
          </Text>
          {code.parameters.map((p) => (
            <TextField
              key={p.key}
              label={p.required ? p.label : `${p.label} (optional)`}
              help={p.formatHint ?? undefined}
              value={values[p.key] ?? ""}
              onChangeText={(text) => setValues((v) => ({ ...v, [p.key]: text }))}
              keyboardType={p.kind === "amount" || p.kind === "phone" ? "number-pad" : "default"}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ))}
        </View>
      ) : null}

      <Card style={{ gap: space[3] }}>
        <Text variant="caption" color="textMuted">
          {dialString ? "Your code" : "The code"}
        </Text>
        <Text
          variant="display"
          tabular
          selectable
          color={dialString ? "textPrimary" : "textMuted"}
          accessibilityLabel={dialString ? `Code to dial: ${dialString}` : `Code template: ${code.template}`}
          style={{ fontSize: 26, lineHeight: 32 }}
        >
          {dialString ?? code.template}
        </Text>
        {!dialString ? (
          <Text variant="label" color={touched && !filled.ok ? "attention" : "textMuted"} accessibilityLiveRegion="polite">
            {touched && !filled.ok ? filled.error : "Fill in your details above to get your code."}
          </Text>
        ) : null}

        <Button
          label="Dial this code"
          fullWidth
          disabled={!dialString || blocked}
          onPress={onDial}
        />
        <Button label="Share or copy code" variant="secondary" fullWidth disabled={!dialString} onPress={onShare} />
        <Text variant="caption" color="textMuted" style={{ textAlign: "center" }}>
          You approve it with your provider, on your own phone. OneLedger never asks for your PIN.
        </Text>
        {note ? (
          <Text variant="caption" color="textSecondary" accessibilityRole="alert">
            {note}
          </Text>
        ) : null}
      </Card>

      <View style={{ borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radii.control, overflow: "hidden", backgroundColor: colors.surface }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="About this code"
          accessibilityState={{ expanded: aboutOpen }}
          onPress={() => setAboutOpen((open) => !open)}
          style={({ pressed }) => [
            { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[3] },
            pressed && { backgroundColor: colors.background },
          ]}
        >
          <Text variant="bodyStrong">About this code</Text>
          <Feather name={aboutOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
        </Pressable>
        {aboutOpen ? (
          <View style={{ gap: space[3], padding: space[3], borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
            {code.description ? <Text color="textSecondary">{code.description}</Text> : null}
            {code.cautionText ? <Notice>{code.cautionText}</Notice> : null}
            {code.steps.length > 0 ? (
              <View style={{ gap: space[1] }}>
                <Text variant="bodyStrong">How to use it</Text>
                {code.steps.map((step, i) => (
                  <Text key={i} color="textSecondary">{`${i + 1}. ${step}`}</Text>
                ))}
              </View>
            ) : null}
            <View style={{ gap: space[1] }}>
              <Text variant="bodyStrong">Source</Text>
              <Text variant="label" color="textMuted">
                {code.sourceLabel ?? "Not recorded"}
              </Text>
              {code.sourceUrl ? (
                <Button label="Open the source" size="sm" variant="ghost" onPress={() => Linking.openURL(code.sourceUrl!)} />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      <ReportForm serviceCodeId={code.id} />
    </Screen>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "attention" }) {
  return (
    <Card>
      <Text variant="label" color={tone === "attention" ? "attention" : "textSecondary"}>
        {children}
      </Text>
    </Card>
  );
}

function ReportForm({ serviceCodeId }: { serviceCodeId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType>("incorrect_code");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "done") {
    return (
      <Text color="moneyPositive" accessibilityRole="alert">
        Thanks - we&apos;ll review this.
      </Text>
    );
  }
  if (!open) return <Button label="Report incorrect information" variant="ghost" onPress={() => setOpen(true)} />;

  async function send() {
    setStatus("sending");
    setError(null);
    const failure = await reportServiceCode(serviceCodeId, type, details);
    if (failure) {
      setError(failure);
      setStatus("idle");
    } else setStatus("done");
  }

  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="bodyStrong">Report this code</Text>
      <View style={{ gap: space[1] }}>
        {(Object.keys(REPORT_TYPES) as ReportType[]).map((key) => (
          <Button key={key} label={REPORT_TYPES[key]} variant={type === key ? "primary" : "secondary"} onPress={() => setType(key)} />
        ))}
      </View>
      <TextField label="Details (optional)" value={details} onChangeText={setDetails} multiline maxLength={2000} />
      {error ? (
        <Text variant="caption" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="Send report" fullWidth loading={status === "sending"} onPress={send} />
      <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}
