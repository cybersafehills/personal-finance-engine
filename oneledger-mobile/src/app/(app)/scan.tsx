import { CameraView, useCameraPermissions } from "expo-camera";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Share, View } from "react-native";

import { classifyScan, prepareScan, recordPayHandoff } from "@/api/mobile-api";
import { Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import {
  AMOUNT_ERRORS,
  CLASS_LABELS,
  describeScan,
  dialFromTel,
  FALLBACK_REASON,
  parseUserAmount,
  REASON_MESSAGES,
} from "@/features/scan/review";
import { canReadPoster, recognizePoster } from "@/features/scan/poster-recognition";
import { parseMerchantPoster, type MerchantPoster } from "@/features/scan/poster";
import { parseRecipient } from "@/features/pay/new-form";
import type { ClassifyResult, ScanModel } from "@/features/scan/types";
import { colors, radii, space } from "@/theme/tokens";

type Phase =
  | { step: "scanning" }
  | { step: "checking" }
  | { step: "readingPoster" }
  | { step: "posterReview"; poster: MerchantPoster }
  | { step: "notice"; message: string; disabled?: boolean }
  | { step: "review"; raw: string; model: ScanModel }
  | { step: "preparing"; raw: string; model: ScanModel }
  | { step: "ready"; raw: string; model: ScanModel; intentId: string | null; telHref: string }
  | { step: "awaiting"; intentId: string | null };

// Scan to pay, as on the web: read a merchant QR, have the server check it
// (a verified USSD code, an approved link or a OneLedger merchant code), review
// it, then hand it over. The scan is data, never authorization: nothing is
// dialed on detection, one tap prepares a draft, and the app never claims the
// payment settled. Poster photos are processed on-device and deleted after OCR.
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ step: "scanning" });
  const [torch, setTorch] = useState(false);
  const [mode, setMode] = useState<"qr" | "poster">("qr");
  const [cameraReady, setCameraReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const handled = useRef(false);


  function scanAgain() {
    handled.current = false;
    setCameraReady(false);
    setPhase({ step: "scanning" });
  }

  async function readPoster() {
    if (handled.current || !cameraReady || !camera.current || !canReadPoster) return;
    handled.current = true;
    setPhase({ step: "readingPoster" });
    try {
      const photo = await camera.current.takePictureAsync({ quality: 1, exif: false });
      if (!photo?.uri) throw new Error("No photo");
      // Finish recognition even after leaving, so the native module deletes the photo.
      const text = await recognizePoster(photo.uri);
      if (!mounted.current) return;
      const poster = parseMerchantPoster(text);
      setPhase(poster ? { step: "posterReview", poster } : {
        step: "notice",
        message: "Couldn't read one clear MTN merchant code. Include the full *182*8*1*code# line, move closer and avoid glare. You can also enter the code yourself.",
      });
    } catch {
      if (mounted.current) setPhase({ step: "notice", message: "Couldn't read the poster. Hold steady and try again, or enter the merchant code yourself." });
    }
  }

  async function onScanned(raw: string) {
    if (handled.current) return; // one code at a time; the camera fires repeatedly
    handled.current = true;
    setPhase({ step: "checking" });
    const res = await classifyScan(raw);
    if (!res.ok) {
      setPhase(
        res.disabled
          ? { step: "notice", message: "Scan to pay isn't available on your account right now.", disabled: true }
          : { step: "notice", message: "OneLedger couldn't check this code. Check your connection and try again." },
      );
      return;
    }
    const result: ClassifyResult = res.result;
    if (!result.ok) {
      setPhase({ step: "notice", message: REASON_MESSAGES[result.reason] ?? FALLBACK_REASON });
      return;
    }
    setPhase({ step: "review", raw, model: result.model });
  }

  if (!permission) {
    return (
      <Screen>
        <Text variant="label" color="textMuted">
          Checking camera access…
        </Text>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <ScreenHeader title="Scan to pay" subtitle="Scan a payment QR code or an MTN merchant poster." />
        <EmptyState
          variant="setup"
          title="OneLedger needs the camera to read a payment code"
          description="QR codes are read directly. Poster photos are read on your phone and deleted after reading. You can still enter a merchant code yourself."
          action={
            permission.canAskAgain ? (
              <Button label="Allow camera" onPress={requestPermission} />
            ) : (
              <Button label="Open settings" variant="secondary" onPress={() => Linking.openSettings()} />
            )
          }
        />
      </Screen>
    );
  }

  if (phase.step === "scanning" || phase.step === "checking" || phase.step === "readingPoster") {
    return (
      <Screen>
        <ScreenHeader title="Scan to pay" subtitle={mode === "qr" ? "Point your camera at the merchant’s payment QR code." : "Fit the merchant name and full *182*8*1*code# line inside the frame."} />
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button label="QR code" variant={mode === "qr" ? "primary" : "secondary"} disabled={phase.step !== "scanning"} onPress={() => setMode("qr")} />
          <Button label="Merchant poster" variant={mode === "poster" ? "primary" : "secondary"} disabled={phase.step !== "scanning"} onPress={() => setMode("poster")} />
        </View>
        <View
          style={{ height: 320, borderRadius: radii.card, overflow: "hidden", backgroundColor: colors.surface }}
          accessible
          accessibilityLabel="Camera viewfinder"
        >
          <CameraView
            ref={camera}
            onCameraReady={() => setCameraReady(true)}
            style={{ flex: 1 }}
            facing="back"
            autofocus="on"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={mode === "qr" && phase.step === "scanning" ? ({ data }) => void onScanned(data) : undefined}
          />
        </View>
        <Text variant="label" color="textSecondary" accessibilityRole="alert">
          {phase.step === "readingPoster" ? "Reading the poster…" : phase.step === "checking" ? "Checking the code…" : mode === "poster" ? "Hold steady, then tap Read merchant poster." : "Camera is on. Position the QR code inside the frame."}
        </Text>
        {mode === "poster" ? <>
          <Text variant="caption" color="textMuted">The photo is read on your phone and deleted after reading. Check handwritten digits carefully.</Text>
          {canReadPoster ? <Button label="Read merchant poster" accessibilityLabel="Read merchant poster" loading={phase.step === "readingPoster"} disabled={!cameraReady || phase.step !== "scanning"} onPress={() => void readPoster()} /> :
            <Text accessibilityRole="alert">Poster reading is unavailable in this build. Enter the merchant code below.</Text>}
          <Button label="Enter merchant code" variant="secondary" disabled={phase.step !== "scanning"} onPress={() => router.replace({ pathname: "/pay-new", params: { type: "pay_merchant" } })} />
        </> : null}
        <Button
          disabled={phase.step !== "scanning"}
          label={torch ? "Turn off flashlight" : "Turn on flashlight"}
          variant="secondary"
          onPress={() => setTorch((t) => !t)}
        />
      </Screen>
    );
  }

  if (phase.step === "notice") {
    return (
      <Screen>
        <ScreenHeader title="Scan to pay" />
        <Card style={{ gap: space[3] }}>
          <Text accessibilityRole="alert">{phase.message}</Text>
          {phase.disabled ? null : <Button label="Scan again" onPress={scanAgain} />}
          {mode === "poster" && !phase.disabled ? <Button label="Enter merchant code" variant="secondary" onPress={() => router.replace({ pathname: "/pay-new", params: { type: "pay_merchant" } })} /> : null}
        </Card>
      </Screen>
    );
  }

  if (phase.step === "awaiting") {
    return (
      <Screen>
        <ScreenHeader title="Awaiting confirmation" />
        <Card style={{ gap: space[3] }}>
          <Text color="textSecondary">
            OneLedger opened the instruction on your device. Authorize it with your provider. OneLedger marks a payment confirmed
            only when it sees matching evidence — opening the dialer is not proof of payment.
          </Text>
          <Button label="Scan again" onPress={scanAgain} />
          <Button label="Done" variant="ghost" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  if (phase.step === "posterReview") return <PosterReview poster={phase.poster} onScanAgain={scanAgain} />;

  return <ReviewStep phase={phase} setPhase={setPhase} onScanAgain={scanAgain} />;
}

function ReviewStep({
  phase,
  setPhase,
  onScanAgain,
}: {
  phase: Extract<Phase, { step: "review" | "preparing" | "ready" }>;
  setPhase: (p: Phase) => void;
  onScanAgain: () => void;
}) {
  const { raw, model } = phase;
  const review = describeScan(model);
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inFlight = useRef(false);

  const again = (
    <View style={{ gap: space[2] }}>
      <Button label="Scan again" variant="secondary" onPress={onScanAgain} />
    </View>
  );

  async function prepare() {
    if (inFlight.current) return;
    let amountMinor: number | undefined;
    if (review.needsAmount) {
      const parsed = parseUserAmount(amountText);
      if (!parsed.ok) {
        setAmountError(AMOUNT_ERRORS[parsed.reason]);
        return;
      }
      amountMinor = parsed.minor;
    }
    setAmountError(null);
    inFlight.current = true;
    setPhase({ step: "preparing", raw, model });
    const res = await prepareScan(raw, amountMinor);
    inFlight.current = false;
    if (!res.ok) {
      setPhase({ step: "notice", message: "OneLedger couldn't prepare this payment. Try again." });
      return;
    }
    const o = res.outcome;
    if (o.status === "prepared") setPhase({ step: "ready", raw, model, intentId: o.intentId, telHref: o.telHref });
    else if (o.status === "info_only") setPhase({ step: "ready", raw, model, intentId: null, telHref: o.telHref });
    else if (o.status === "amount_required") {
      setAmountError(AMOUNT_ERRORS.required);
      setPhase({ step: "review", raw, model });
    } else if (o.status === "currency_unsupported") {
      setPhase({ step: "notice", message: "OneLedger can only continue a scanned payment in RWF right now." });
    } else if (o.status === "unsupported") {
      setPhase({
        step: "notice",
        message: "OneLedger can't continue this code from a scan. It has no verified USSD path for this provider yet.",
      });
    } else if (o.status === "feature_disabled") {
      setPhase({ step: "notice", message: "Scan to pay isn't available on your account right now.", disabled: true });
    } else {
      setPhase({ step: "notice", message: "OneLedger couldn't prepare this payment. Try again." });
    }
  }

  async function record(intentId: string | null, method: "dialer" | "copy", outcome: "dialer_opened" | "copied") {
    if (!intentId) return;
    // A navigation event only; failing to record it never blocks the user.
    await (method === "dialer"
      ? recordPayHandoff(intentId, { method: "dialer", outcome: outcome as "dialer_opened" })
      : recordPayHandoff(intentId, { method: "copy", outcome: outcome as "copied" })
    ).catch(() => undefined);
  }

  const fields = (
    <Card style={{ gap: space[2] }}>
      <Text variant="caption" color="textMuted">
        What was scanned
      </Text>
      {review.rows.map((row) => (
        <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
          <Text variant="label" color="textMuted">
            {row.label}
          </Text>
          <Text variant="label" tabular style={{ flexShrink: 1, textAlign: "right" }}>
            {row.value}
          </Text>
        </View>
      ))}
    </Card>
  );
  const notices = review.notices.map((n) => (
    <Text key={n} variant="caption" color="textMuted">
      {n}
    </Text>
  ));

  if (!review.isActionable) {
    return (
      <Screen>
        <ScreenHeader title="Review this payment" />
        {fields}
        {notices}
        <Text variant="label" color="textSecondary">
          {review.blocked === "currency"
            ? "OneLedger can only continue a scanned payment in RWF right now."
            : "OneLedger can't continue this code from a scan. It has no verified USSD path for this provider yet."}
        </Text>
        {again}
      </Screen>
    );
  }

  if (phase.step === "ready") {
    const dial = dialFromTel(phase.telHref);
    return (
      <Screen>
        <ScreenHeader title="Review this payment" />
        {fields}
        {notices}
        <Text variant="caption" color="textMuted">
          OneLedger will open this instruction on your device. You review and authorize the payment with your mobile network or
          provider — OneLedger never sees your PIN and can&apos;t send money for you.
        </Text>
        <Card>
          <Text variant="heading" tabular accessibilityLabel={`Code to dial: ${dial}`}>
            {dial}
          </Text>
        </Card>
        <Button
          label="Share or copy code"
          variant="secondary"
          fullWidth
          onPress={async () => {
            try {
              const r = await Share.share({ message: dial });
              if (r.action === Share.sharedAction) await record(phase.intentId, "copy", "copied");
            } catch {
              setNote("Couldn't open the share sheet. Select the code above and copy it.");
            }
          }}
        />
        {Platform.OS === "android" ? (
          <Button
            label={review.isMenu ? "Open USSD menu" : "Open phone dialer"}
            fullWidth
            onPress={async () => {
              try {
                await Linking.openURL(phase.telHref);
                await record(phase.intentId, "dialer", "dialer_opened");
                setPhase({ step: "awaiting", intentId: phase.intentId });
              } catch {
                setNote("Couldn't open the dialer. Share or copy the code and dial it yourself.");
              }
            }}
          />
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
        {again}
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Review this payment" subtitle={CLASS_LABELS[model.class]} />
      {fields}
      {notices}
      <Text variant="caption" color="textMuted">
        OneLedger will open this instruction on your device. You review and authorize the payment with your mobile network or
        provider — OneLedger never sees your PIN and can&apos;t send money for you.
      </Text>
      {review.needsAmount ? (
        <TextField
          label="Amount to pay (RWF)"
          help="This code didn't include an amount — enter it, then check it against the merchant."
          value={amountText}
          onChangeText={(t) => {
            setAmountText(t);
            setAmountError(null);
          }}
          keyboardType="number-pad"
          error={amountError ?? undefined}
          editable={phase.step === "review"}
        />
      ) : null}
      {phase.step === "preparing" ? (
        <Text variant="label" color="textMuted" accessibilityRole="alert">
          Preparing…
        </Text>
      ) : (
        <Button
          label={review.isMenu ? "Open USSD menu" : "Prepare payment"}
          fullWidth
          disabled={review.needsAmount && amountText.trim() === ""}
          onPress={prepare}
        />
      )}
      {again}
    </Screen>
  );
}

function PosterReview({ poster, onScanAgain }: { poster: MerchantPoster; onScanAgain: () => void }) {
  const [code, setCode] = useState(poster.merchantCode);
  const [name, setName] = useState(poster.name);
  const recipient = parseRecipient("pay_merchant", code);
  return (
    <Screen>
      <ScreenHeader title="Check merchant details" subtitle="MTN MoMoPay poster" />
      <Text>Compare every digit with the poster, including any leading zero. The name was read from the poster and has not been verified by MTN.</Text>
      <TextField label="Merchant code" value={code} onChangeText={setCode} keyboardType="number-pad" error={recipient.ok ? undefined : recipient.message} />
      <TextField label="Merchant name (optional)" value={name} onChangeText={setName} maxLength={100} />
      <Button label="Continue to merchant payment" disabled={!recipient.ok} onPress={() => {
        if (!recipient.ok) return;
        router.replace({ pathname: "/pay-new", params: { type: "pay_merchant", merchantCode: recipient.merchantCode, merchantName: name.trim() } });
      }} />
      <Button label="Scan again" variant="secondary" onPress={onScanAgain} />
    </Screen>
  );
}
