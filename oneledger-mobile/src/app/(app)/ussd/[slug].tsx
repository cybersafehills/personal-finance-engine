import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Platform, Share, View } from "react-native";

import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { buildTelHref, fillUssdTemplate, type ParamSpec } from "@/features/ussd/capability";
import { getFavouriteIds, getServiceCodeBySlug, reportServiceCode, REPORT_TYPES, toggleFavourite, type ReportType } from "@/features/ussd/queries";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

const HANDOFF = "You'll authorize this with your provider, on your own phone. OneLedger never asks for your Mobile Money or banking PIN.";

// One service code, as on the web's /pay/ussd/[slug]: what it does, what you'll
// need, the code filled in, how to use it, and where it came from. It shows and
// hands over the code; it never dials by itself and never claims anything was paid.
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

  const back = <Button label="Back" variant="ghost" onPress={() => router.back()} />;

  if (!data) {
    return (
      <Screen>
        {back}
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
  const filled = code.acceptsParameters
    ? fillUssdTemplate(code.template, values, specs)
    : ({ ok: true, display: code.template, dial: code.template } as const);
  const dialString = filled.ok ? filled.dial : null;
  const deprecated = code.state === "deprecated";
  const unavailable = code.state === "temporarily_unavailable";

  async function onShare() {
    if (!dialString) return;
    try {
      await Share.share({ message: dialString });
    } catch {
      setNote("Couldn't open the share sheet. Select the code above and copy it.");
    }
  }

  async function onDial() {
    if (!dialString) return;
    try {
      await Linking.openURL(buildTelHref(dialString));
    } catch {
      setNote("Couldn't open the dialer. Share or copy the code and dial it yourself.");
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
      {back}
      <ScreenHeader title={code.name} subtitle={code.provider} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Badge variant={code.verified ? "positive" : "attention"}>{code.verified ? "Verified" : "Not officially verified"}</Badge>
        <Text variant="bodyStrong" tabular>
          {code.template}
        </Text>
      </View>
      <Button label={favourite ? "Remove from favourites" : "Add to favourites"} variant="secondary" onPress={onStar} />

      {code.description ? <Text color="textSecondary">{code.description}</Text> : null}
      {deprecated ? (
        <Notice tone="attention">
          This code is deprecated and may no longer work.
          {code.replacementSlug ? " " : ""}
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
      {code.cautionText ? <Notice>{code.cautionText}</Notice> : null}
      {code.riskText ? <Notice tone="attention">{code.riskText}</Notice> : null}

      {code.acceptsParameters && code.parameters.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            You&apos;ll need
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
          {!filled.ok ? (
            <Text variant="caption" color="attention" accessibilityRole="alert">
              {filled.error}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Notice>{HANDOFF}</Notice>

      {dialString ? (
        <Card>
          <Text variant="heading" tabular accessibilityLabel={`Code to dial: ${dialString}`}>
            {dialString}
          </Text>
        </Card>
      ) : null}
      <View style={{ gap: space[2] }}>
        <Button label="Share or copy code" variant="secondary" fullWidth disabled={!dialString} onPress={onShare} />
        {Platform.OS === "android" ? (
          <Button label="Open phone dialer" fullWidth disabled={!dialString} onPress={onDial} />
        ) : (
          <Text variant="caption" color="textMuted">
            On iPhone, copy the code and dial it in the Phone app.
          </Text>
        )}
        {note ? (
          <Text variant="caption" color="textSecondary" accessibilityRole="alert">
            {note}
          </Text>
        ) : null}
      </View>

      {code.steps.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            How to do this on your phone
          </Text>
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
          <Button label="Open the source" variant="ghost" onPress={() => Linking.openURL(code.sourceUrl!)} />
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
