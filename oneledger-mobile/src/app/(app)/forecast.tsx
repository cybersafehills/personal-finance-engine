import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button, Card, Chip, EmptyState, ProgressBar, Screen, ScreenHeader, Text } from "@/components/ds";
import { fetchForecast, FORECAST_DAYS, type ForecastDays, type WalletForecast } from "@/features/insights/forecast";
import { fetchIntelligence, type Intelligence } from "@/features/insights/intelligence";
import { OutlookAdSlot } from "@/features/insights/OutlookAdSlot";
import { OutlookCard } from "@/features/insights/OutlookCard";
import { OutlookChart } from "@/features/insights/OutlookChart";
import { OwnAccountPrompt } from "@/features/insights/OwnAccountPrompt";
import { isSection, ScrollToSection, useJumpToSection, useSectionAnchors, type SectionAnchors } from "@/features/insights/ScrollToSection";
import { SectionShell, toneColors } from "@/features/insights/SectionShell";
import {
  commitmentLine, datedPayments, formatPlain, largePaymentLine, largePaymentsTitle, outlookFor, paceStory,
  repeatingLine, repeatingMonthlyTotal, repeatingTitle, sectionPlan, TONE_STATUS, walkRows, worstOutlook,
  type SectionId, type SectionPlan,
} from "@/features/insights/story";
import { useFirstVisit } from "@/features/insights/useFirstVisit";
import { WhyThisInsight } from "@/features/insights/WhyThisInsight";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { space } from "@/theme/tokens";

// Your money outlook: the full page behind Home's summary. Four sections, each answering one question -
// will my money last, how is my spending this month, is anything unusually big, what repeats every
// month. They are ordered by how much each needs YOUR attention (red, amber, blue, green), and Home's
// rows open this page at the matching section. Every number is an estimate from your own ledger and is
// labelled as one; nothing here is advice. Written to be read by anyone from a teenager to a grandparent.

export default function Forecast() {
  const { activeId } = useActiveSpace();
  // Keyed by Space so a switch never shows the previous Space's figures.
  return activeId ? <ForecastForSpace key={activeId} workspaceId={activeId} /> : (
    <Screen><ScreenHeader title="Your money outlook" /><Text variant="label" color="textMuted">Loading…</Text></Screen>
  );
}

function ForecastForSpace({ workspaceId }: { workspaceId: string }) {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [days, setDays] = useState<ForecastDays>(30);
  const [walletId, setWalletId] = useState<string | null>(null);
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const hidden = amountsHidden || fullPrivacy;
  const loadForecast = useCallback(() => fetchForecast({ workspaceId, accountId: null, days }), [workspaceId, days]);
  const forecast = useQuery(loadForecast, `${workspaceId}|${days}`);
  const loadFacts = useCallback(() => fetchIntelligence(workspaceId), [workspaceId]);
  const facts = useQuery(loadFacts, workspaceId);

  const result = forecast.data;
  const factsData = facts.data?.ok ? facts.data : null;
  const allWallets = result && result.ok ? result.wallets : [];
  // A wallet picker only when there is a choice; filtering is local (one request covers every wallet).
  const wallets = walletId ? allWallets.filter((w) => w.id === walletId) : allWallets;
  const estimatesIncome = allWallets.some((w) => w.estimatesIncome);
  const unavailable = result && !result.ok && result.reason === "unavailable";
  const computedAt = result && result.ok ? result.computedAt : new Date().toISOString();

  const outlooks = useMemo(() => wallets.map((w) => outlookFor(w, days, hidden, computedAt)), [wallets, days, hidden, computedAt]);
  const pace = factsData?.baseline ? paceStory(factsData.baseline, hidden) : null;
  const plan = useMemo(
    () => sectionPlan({ outlook: worstOutlook(outlooks), pace, largeCount: factsData?.anomalies.length ?? 0, repeatCount: factsData?.recurring.length ?? 0 }),
    [outlooks, pace, factsData],
  );

  // One anchor per section, so a row on Home (or a "jump to" chip) can scroll straight to it.
  const anchors = useSectionAnchors();
  // Sections appear and reorder as the two answers arrive, so a deep link waits for both.
  const settled = !forecast.loading && !facts.loading;

  const body: Record<SectionId, React.ReactNode> = {
    outlook: <OutlookSection wallets={wallets} outlooks={outlooks} days={days} hidden={hidden} showNames={allWallets.length > 1} />,
    pace: pace && factsData?.baseline ? <PaceSection pace={pace} data={factsData} hidden={hidden} /> : null,
    large: factsData ? <LargeSection data={factsData} hidden={hidden} /> : null,
    repeat: factsData ? <RepeatSection data={factsData} hidden={hidden} /> : null,
  };
  const META: Record<SectionId, { icon: React.ComponentProps<typeof Feather>["name"]; title: string; subtitle: string }> = {
    outlook: { icon: "calendar", title: `The next ${days} days`, subtitle: "Will your money last?" },
    pace: { icon: "bar-chart-2", title: "Spending this month", subtitle: "Compared with what you usually spend by now" },
    large: { icon: "alert-circle", title: "Payments to check", subtitle: "Much bigger than you usually pay the same person or shop" },
    repeat: { icon: "repeat", title: "Payments that repeat", subtitle: "Paid again and again, around the same time each month" },
  };

  return (
    <Screen>
      <ScreenHeader title="Your money outlook" subtitle="Will your money last, and what stands out" />
      <ScrollToSection section={section} ready={settled} available={plan.map((p) => p.id)} anchors={anchors} />
      <Intro deepLinked={isSection(section)} />

      {allWallets.length > 1 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" color="textMuted">Which wallet</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Chip label="All wallets" selected={walletId === null} onPress={() => setWalletId(null)} />
            {allWallets.map((w) => <Chip key={w.id} label={w.name} selected={walletId === w.id} onPress={() => setWalletId(w.id)} />)}
          </View>
        </View>
      ) : null}

      <View style={{ gap: space[1] }}>
        <Text variant="caption" color="textMuted">How far ahead</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {FORECAST_DAYS.map((d) => <Chip key={d} label={`${d} days`} selected={d === days} onPress={() => setDays(d)} />)}
        </View>
      </View>

      {!result && forecast.loading ? (
        <Text variant="label" color="textMuted" accessibilityLiveRegion="polite">Working out your outlook…</Text>
      ) : unavailable ? (
        <EmptyState title={result.message} />
      ) : (forecast.error || (result && !result.ok)) ? (
        <EmptyState title={result && !result.ok ? result.message : "Couldn’t load your outlook."}
          action={<Button label="Try again" variant="secondary" onPress={() => { forecast.refresh(); facts.refresh(); }} />} />
      ) : result && result.ok && wallets.length === 0 ? (
        <EmptyState title="Not enough to look ahead yet" description="To look ahead we need a recorded balance for a wallet and a few weeks of activity to learn your usual pace from." />
      ) : null}

      {plan.length > 0 ? <AtAGlance plan={plan} titles={META} anchors={anchors} /> : null}
      {result && result.ok ? <Text variant="caption" color="textMuted">{`Worked out ${formatDateTime(result.computedAt)}.`}</Text> : null}

      {plan.map((item, index) => (
        <View key={item.id} style={{ gap: space[3] }}>
          <SectionShell tone={item.tone} icon={META[item.id].icon} title={META[item.id].title} subtitle={META[item.id].subtitle} anchor={anchors[item.id]}>
            {body[item.id]}
            {item.id === "outlook" && estimatesIncome ? <OwnAccountPrompt onChanged={() => { forecast.refresh(); facts.refresh(); }} /> : null}
          </SectionShell>
          {index === 0 ? <OutlookAdSlot /> : null}
        </View>
      ))}
      {plan.length === 0 && settled ? <OutlookAdSlot /> : null}

      <Text variant="caption" color="textMuted">
        These are estimates from your own recent activity, not promises and not financial advice. They update as new transactions arrive.
      </Text>
    </Screen>
  );
}

/** "What is this page?" - open the first time someone visits, one tap away afterwards. */
function Intro({ deepLinked }: { deepLinked: boolean }) {
  const { first, dismiss } = useFirstVisit("oneledger.outlook.intro.v1");
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  // Someone who came for one section (a Home row) stays collapsed: an intro that loads late would push
  // the section they are scrolling to out of view.
  if (!((first && !deepLinked) || open)) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="What is this page?" hitSlop={12} onPress={() => setOpen(true)}>
        <Text variant="caption" color="accent">What is this page?</Text>
      </Pressable>
    );
  }
  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="bodyStrong">What you can do here</Text>
      <Text color="textSecondary">A quick look at where your money is heading, so nothing surprises you. Check it once a week.</Text>
      {[
        ["calendar", "See if your money will last over the next 7 to 30 days."],
        ["bar-chart-2", "Compare this month’s spending with your usual."],
        ["alert-circle", "Spot a payment that was much bigger than usual."],
        ["repeat", "See the payments that come back every month."],
      ].map(([icon, line]) => (
        <View key={line} style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
          <Feather name={icon as "calendar"} size={16} color={colors.textMuted} style={{ marginTop: 3 }} />
          <Text style={{ flex: 1 }}>{line}</Text>
        </View>
      ))}
      <Text variant="caption" color="textMuted">Everything is worked out from your own transactions. Nothing is shared. Red means act now, amber means take a look, blue is good to know, green means all good.</Text>
      <Button label="Got it" variant="secondary" size="sm" onPress={() => { dismiss(); setOpen(false); }} />
    </Card>
  );
}

/** A one-line summary and a tap-to-jump strip, most important first. */
function AtAGlance({ plan, titles, anchors }: { plan: SectionPlan[]; titles: Record<SectionId, { title: string }>; anchors: SectionAnchors }) {
  const onJump = useJumpToSection(anchors); // read inside <Screen>: that is where the scroll view provides it
  const { colors } = useTheme();
  const styles = useStyles();
  const counts = plan.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.tone]: (acc[p.tone] ?? 0) + 1 }), {});
  const summary = (["urgent", "check", "info", "good"] as const).filter((t) => counts[t]).map((t) => `${counts[t]} ${TONE_STATUS[t].toLowerCase()}`).join(" · ");
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="bodyStrong" accessibilityLiveRegion="polite">{summary}</Text>
      <View style={styles.strip}>
        {plan.map((p) => {
          const t = toneColors(colors, p.tone);
          return (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${titles[p.id].title}. ${p.status}. Jump to this section.`} onPress={() => onJump(p.id)}
              style={({ pressed }) => [styles.jump, { backgroundColor: t.wash, borderColor: t.ink }, pressed && { opacity: 0.6 }]}>
              <Feather name={t.icon} size={14} color={t.ink} />
              <Text variant="caption" style={{ color: t.ink, fontWeight: "600" }}>{titles[p.id].title}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Section 1: will my money last? Verdict, picture, the step-by-step sum, then dated payments. */
function OutlookSection({ wallets, outlooks, days, hidden, showNames }: { wallets: WalletForecast[]; outlooks: ReturnType<typeof outlookFor>[]; days: number; hidden: boolean; showNames: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <>
      {wallets.map((wallet, i) => {
        const outlook = outlooks[i];
        const walk = walkRows(wallet, days, hidden);
        const items = datedPayments(wallet);
        return (
          <View key={wallet.id} style={{ gap: space[3] }}>
            {showNames ? <Text variant="bodyStrong">{wallet.name}</Text> : null}
            <OutlookCard outlook={outlook} />
            <OutlookChart wallet={wallet} days={days} runsOutInDays={outlook.runsOutInDays} />

            <View style={styles.panel}>
              <Text variant="bodyStrong">{`How we get from today to day ${days}`}</Text>
              {walk.map((row) => {
                const last = row.key === "end";
                return (
                  <View key={row.key} style={[styles.walkRow, last && { paddingTop: space[2], borderTopWidth: 1, borderTopColor: colors.borderStrong }]} accessible accessibilityLabel={`${row.label}: ${row.text}. ${row.hint}`}>
                    <View style={{ flexShrink: 1 }}>
                      <Text variant={last ? "bodyStrong" : "body"}>{row.label}</Text>
                      <Text variant="caption" color="textMuted">{row.hint}</Text>
                    </View>
                    <Text variant={last ? "bodyStrong" : "body"} tabular>{row.text}</Text>
                  </View>
                );
              })}
              <WhyThisInsight
                basis={[
                  "We start from the balance you last recorded.",
                  "We add or remove payments that have a regular date: bills and repeating payments.",
                  "Everyday spending is an estimate from your last 3 months, spread evenly over each day.",
                  wallet.estimatesIncome ? "Money coming in is an estimate of your usual income. Moves between your own accounts are not counted." : "There is not enough history yet to estimate money coming in, so none is assumed.",
                ]}
                period={`Today to day ${days}`}
                method="Balance now, plus dated payments, minus the usual daily spending, plus the usual daily income."
              />
            </View>

            <View style={styles.panel}>
              <Text variant="bodyStrong">{`Payments with a date in the next ${days} days`}</Text>
              {items.length === 0 ? (
                <Text variant="caption" color="textMuted">None found. The numbers above are everyday spending only.</Text>
              ) : items.map((item) => (
                <View key={`${item.day}-${item.label}`} style={styles.walkRow} accessible accessibilityLabel={`In ${item.day} days, ${item.label}. ${commitmentLine(item.delta, hidden)}`}>
                  <View style={{ flexShrink: 1 }}>
                    <Text>{item.label}</Text>
                    <Text variant="caption" color="textMuted">{`In ${item.day} days`}</Text>
                  </View>
                  <Text tabular color={item.delta < 0n ? "textPrimary" : "moneyPositive"} style={{ textAlign: "right", flexShrink: 1 }}>{commitmentLine(item.delta, hidden)}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </>
  );
}

function PaceSection({ pace, data, hidden }: { pace: ReturnType<typeof paceStory>; data: Intelligence; hidden: boolean }) {
  const styles = useStyles();
  return (
    <>
      <Text variant="heading" color={pace.tone === "watch" ? "attention" : pace.tone === "good" ? "moneyPositive" : "textPrimary"}>{pace.title}</Text>
      <Text color="textSecondary">{pace.sentence}</Text>
      {!hidden ? (
        <View style={styles.panel}>
          <View style={{ gap: 4 }}>
            <Text variant="caption" color="textMuted">{`This month so far · ${formatPlain(pace.spent)}`}</Text>
            <ProgressBar label="Spent this month so far" fraction={pace.fraction >= 1 ? 1 : pace.fraction} tone={pace.tone === "watch" ? "attention" : "accent"} />
          </View>
          <View style={{ gap: 4 }}>
            <Text variant="caption" color="textMuted">{`Usually by now · ${formatPlain(pace.usual)}`}</Text>
            <ProgressBar label="What you usually spend by now" fraction={pace.fraction > 1 ? 1 / pace.fraction : 1} tone="positive" />
          </View>
        </View>
      ) : null}
      <WhyThisInsight basis={data.baseline!.basis} period={`This month against your last ${data.baseline!.monthsCompared} full months`}
        method="We add up what you spent in the first days of this month and compare it with the same days in earlier months." />
    </>
  );
}

function LargeSection({ data, hidden }: { data: Intelligence; hidden: boolean }) {
  return (
    <>
      <Text variant="bodyStrong">{largePaymentsTitle(data.anomaliesTotal)}</Text>
      {data.anomalies.map((a) => {
        const line = largePaymentLine(a, hidden);
        return (
          <View key={`${a.counterparty}:${a.occurredAt}`} style={{ gap: 2 }} accessible accessibilityLabel={`${line.who}. ${line.detail}`}>
            <Text>{line.who}</Text>
            <Text variant="caption" color="textSecondary">{line.detail}</Text>
          </View>
        );
      })}
      {data.anomaliesTotal > data.anomalies.length ? <Text variant="caption" color="textMuted">{`and ${data.anomaliesTotal - data.anomalies.length} more`}</Text> : null}
      <Text variant="caption" color="textMuted">If you made these payments, there is nothing to do.</Text>
      <WhyThisInsight
        basis={["A single payment far above what you usually pay the same person or shop.", "Only people and shops you have paid several times before are checked.", "A payment is flagged when it is at least 3 times the usual amount and the difference is meaningful."]}
        period="The last 30 days" method="We compare each recent payment with the middle value of your earlier payments to them." />
    </>
  );
}

function RepeatSection({ data, hidden }: { data: Intelligence; hidden: boolean }) {
  return (
    <>
      <Text variant="bodyStrong">{repeatingTitle(data.recurringTotal)}</Text>
      {!hidden && data.recurring.length === data.recurringTotal ? <Text color="textSecondary">{`Together they come to about ${formatPlain(repeatingMonthlyTotal(data.recurring))} a month.`}</Text> : null}
      {data.recurring.map((p) => {
        const line = repeatingLine(p, hidden);
        return (
          <View key={`${p.counterparty}:${p.category ?? ""}`} style={{ gap: 2 }} accessible accessibilityLabel={`${line.who}. ${line.detail}`}>
            <Text>{line.who}</Text>
            <Text variant="caption" color="textSecondary">{line.detail}</Text>
          </View>
        );
      })}
      {data.recurringTotal > data.recurring.length ? <Text variant="caption" color="textMuted">{`and ${data.recurringTotal - data.recurring.length} more`}</Text> : null}
      <WhyThisInsight
        basis={["Payments to the same person or shop, in the same category, for a similar amount.", "Seen in at least 2 of your last 4 full months.", "Amounts within 15% of each other count as the same payment."]}
        period="The last 4 full months" method="We group payments by who and what for, then look for ones that come back month after month." />
    </>
  );
}

const useStyles = makeStyles((c) => StyleSheet.create({
  strip: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  jump: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: space[3], borderRadius: 999, borderWidth: 1 },
  panel: { backgroundColor: c.background, borderRadius: 12, padding: space[3], gap: space[2] },
  walkRow: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
}));
