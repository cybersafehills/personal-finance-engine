import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Badge, Card, Text } from "@/components/ds";
import type { CurrencyOverview } from "@/features/insights/types";
import type { CurrentBalance } from "@/features/transactions/queries";
import type { Wallet } from "@/features/wallets/types";
import { STATUS_LABEL, PROVIDER_LABEL } from "@/features/wallets/display";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { MenuGroup, MenuRow } from "@/features/settings/MenuUI";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { compactMoney, changeBps, greeting, percentText, retainedPercent, walletTotal } from "./live-data";
import { Donut } from "./Charts";

export function HomeHeader({ name, now, unread }: { name: string; now: Date; unread: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { active, spaces, setActive } = useActiveSpace();
  const [choosing, setChoosing] = useState(false);
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Change Space" disabled={spaces.length < 2} onPress={() => setChoosing(true)} style={{ minHeight: 44, justifyContent: "center" }}>
      <Text variant="caption" color="textMuted">{active?.name ?? "Workspace"} / Overview {spaces.length > 1 ? "⌄" : ""}</Text>
    </Pressable>
    <View style={styles.header}>
      <Text variant="title" accessibilityRole="header" style={styles.greeting}>{greeting(now.getHours())},{'\n'}{name.split(/\s+/)[0]} 👋</Text>
      <View style={{ flexDirection: "row", gap: 5 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Search transactions" onPress={() => router.navigate("/transactions")} style={styles.iconButton}><Feather name="search" size={18} color={colors.textPrimary} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push("/notifications")} style={styles.iconButton}><Feather name="bell" size={18} color={colors.textPrimary} />{unread > 0 ? <View style={styles.notificationDot} /> : null}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => router.push("/settings")} style={styles.avatar}><Text variant="heading" color="accent">{name.slice(0, 1).toUpperCase()}</Text></Pressable>
      </View>
    </View>
    <Modal transparent animationType="fade" visible={choosing} onRequestClose={() => setChoosing(false)}>
      <View style={styles.scrim}><View style={styles.spaceSheet} accessibilityViewIsModal>
        <MenuGroup title="Choose a Space">{spaces.map((s) => <MenuRow key={s.id} label={s.name} selected={active?.id === s.id} role="radio" onPress={() => { setActive(s.id); setChoosing(false); }} />)}</MenuGroup>
        <Pressable accessibilityRole="button" onPress={() => setChoosing(false)} style={styles.iconButton}><Text color="accent">Close</Text></Pressable>
      </View></View>
    </Modal>
  </View>;
}

export function HomeSection({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  const styles = useStyles();
  return <Card style={styles.section}><View style={styles.sectionHeading}><View style={{ flex: 1, gap: 4 }}><Text variant="heading">{title}</Text>{subtitle ? <Text variant="caption" color="textMuted">{subtitle}</Text> : null}</View>{action}</View>{children}</Card>;
}
export function HomeLink({ label, onPress }: { label: string; onPress(): void }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><Text variant="caption" color="textMuted">{label} →</Text></Pressable>;
}

export function HeroBalance({ wallets, currency, fallback, loading }: { wallets: Wallet[] | null; currency: SupportedCurrency; fallback: CurrentBalance | null; loading: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { amountsHidden, toggleAmountsHidden } = usePrivacy();
  const total = wallets ? walletTotal(wallets, currency) : null;
  const useFallback = total?.amount == null && currency === "RWF" && fallback != null;
  const amount = total?.amount ?? (useFallback ? BigInt(fallback!.amountRwf) : null);
  const asOf = useFallback ? fallback!.asOfIso : total?.asOf;
  const status = useFallback ? "Single provider snapshot" : !total?.complete ? "Partial balance" : total.stale ? "Out of date" : total.estimated ? "Estimated" : "Confirmed";
  const label = useFallback ? "Last reported balance" : total?.complete && !total.stale && !total.estimated ? "Total available balance" : "Recorded wallet balance";
  return <View style={{ gap: 7 }}>
    <View style={styles.hero}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none">
        <Defs><LinearGradient id="homeGradient" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.homeGradientStart} /><Stop offset="1" stopColor={colors.homeGradientEnd} /></LinearGradient></Defs>
        <Rect width="100%" height="100%" fill="url(#homeGradient)" />
        <Circle cx={300} cy={-30} r={210} fill="none" stroke={colors.onSolid} strokeOpacity={0.07} strokeWidth={40} />
        <Circle cx={300} cy={-30} r={180} fill="none" stroke={colors.onSolid} strokeOpacity={0.12} strokeWidth={1} />
      </Svg>
      <View style={styles.heroTop}><Text color="onSolid" style={styles.heroLabel}>◇  {label}</Text><Pressable accessibilityRole="button" accessibilityLabel={amountsHidden ? "Show balances" : "Hide balances"} onPress={toggleAmountsHidden} style={styles.eye}><Feather name={amountsHidden ? "eye-off" : "eye"} size={19} color={colors.onSolid} /></Pressable></View>
      <Text variant="display" color="onSolid" tabular adjustsFontSizeToFit numberOfLines={1} style={styles.heroAmount}>{amountsHidden ? "••••••" : amount !== null ? formatMoney(amount, currency) : loading ? "Loading…" : "—"}</Text>
      <Text variant="caption" color="onSolid" style={{ opacity: 0.9 }}>{amount === null ? "No confirmed wallet balance available" : `${status}${total && !useFallback ? ` · ${total.count} wallet${total.count === 1 ? "" : "s"}` : ""}`}</Text>
      <View style={styles.heroActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Add transaction" onPress={() => router.push("/add-transaction")} style={styles.addButton}><Text style={styles.addLabel}>+ Add transaction</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="View wallets" onPress={() => router.push("/wallets")} style={styles.walletButton}><Text variant="bodyStrong" color="onSolid">View wallets ↗</Text></Pressable>
      </View>
    </View>
    <Text variant="caption" color="textMuted">{asOf ? `Balances as of ${formatDateTime(asOf)}` : "Balance freshness not available"}{total && !total.complete && total.count > 0 && !useFallback ? " · Some wallets have no balance" : ""}</Text>
    {useFallback && fallback!.pendingCount ? <Text variant="caption" color="attention">{fallback!.pendingCount} local changes not yet confirmed</Text> : null}
  </View>;
}

export function CashFlow({ currency, current, previous, available, message }: { currency: SupportedCurrency; current: CurrencyOverview | null; previous: CurrencyOverview | null; available: boolean; message: string }) {
  const { amountsHidden } = usePrivacy();
  const styles = useStyles();
  const income = current?.moneyInMinor ?? 0n, expense = current?.moneyOutMinor ?? 0n;
  const retained = retainedPercent(income, expense);
  return <HomeSection title="Monthly cash flow" subtitle="This month · Recorded, settled activity">
    {!available ? <Text color="textMuted">{message}</Text> : <>
      <View style={styles.cashColumns}>
        {[{ label: "↙ Income", amount: income, before: previous?.moneyInMinor ?? null }, { label: "↗ Expenses", amount: expense, before: previous?.moneyOutMinor ?? null }].map((c) => <View key={c.label} style={{ flex: 1, gap: 6 }}>
          <Text variant="caption" color="textMuted">{c.label}</Text>
          <Text variant="title" tabular adjustsFontSizeToFit numberOfLines={1}>{amountsHidden ? "••••••" : compactMoney(c.amount, currency)}</Text>
          <Text variant="caption" color={changeBps(c.amount, c.before) !== null ? "accent" : "textMuted"}>{amountsHidden ? "Comparison hidden" : percentText(changeBps(c.amount, c.before))}</Text>
        </View>)}
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel="Income retained" accessibilityValue={retained !== null && !amountsHidden ? { min: 0, max: 100, now: Math.round(Math.max(0, Math.min(100, retained))) } : undefined}><View style={[styles.fill, { width: `${amountsHidden || retained === null ? 0 : Math.max(0, Math.min(100, retained))}%` }]} /></View>
      <Text variant="caption" color="textMuted">{amountsHidden ? "Amounts hidden" : retained === null ? "No income recorded this month" : retained < 0 ? "Expenses exceeded income this month" : `${Math.round(retained)}% of income retained this month`}</Text>
      <Text variant="caption" color="textMuted">Changes compare the same point last month. Internal transfers are excluded.</Text>
      {current && current.pending.count > 0 ? <Text variant="caption" color="attention">{current.pending.count} pending transactions excluded</Text> : null}
    </>}
  </HomeSection>;
}

export function Spending({ current, available, message }: { current: CurrencyOverview | null; available: boolean; message: string }) {
  const { colors } = useTheme();
  const { amountsHidden } = usePrivacy();
  const styles = useStyles();
  const rows = (current?.byCategory ?? []).filter((c) => c.amountMinor !== 0n).sort((a, b) => a.amountMinor > b.amountMinor ? -1 : 1);
  const negative = rows.some((c) => c.amountMinor < 0n);
  const currency = current?.currency ?? "RWF";
  const slices = rows.length > 4 ? [...rows.slice(0, 3).map((r) => ({ label: r.category, amount: r.amountMinor, category: r.category })), { label: "Other", amount: rows.slice(3).reduce((s, r) => s + r.amountMinor, 0n), category: null }] : rows.map((r) => ({ label: r.category, amount: r.amountMinor, category: r.category }));
  const palette = [colors.chartIncome, colors.chartExpense, colors.chartFood, colors.chartOther];
  const sum = slices.reduce((s, p) => s + p.amount, 0n);
  return <HomeSection title="Spending breakdown" subtitle="Where your money goes">
    {!available ? <Text color="textMuted">{message}</Text> : !rows.length ? <Text color="textMuted">Your spending categories appear after your first settled expense.</Text> : negative ? <><Text color="textMuted">Net spending includes refunds.</Text>{rows.map((r) => <View key={r.category} style={styles.walletRow}><Text>{r.category}</Text><Text>{amountsHidden ? "••••••" : formatMoney(r.amountMinor, currency)}</Text></View>)}</> : <View style={styles.breakdown}>
      <Donut slices={slices.map((s, i) => ({ ...s, color: palette[i] }))} total={<><Text variant="heading" tabular>{amountsHidden ? "••••" : compactMoney(current?.moneyOutMinor ?? sum, currency).replace(currency + " ", "")}</Text><Text variant="caption" color="textMuted">Total spent</Text></>} />
      <View style={{ flex: 1, gap: 6 }}>{slices.map((s, i) => <Pressable key={s.label} accessibilityRole="button" accessibilityLabel={`${s.label}, ${amountsHidden ? "amount hidden" : formatMoney(s.amount, currency)}`} onPress={() => router.navigate({ pathname: "/transactions", params: { category: s.category ?? "", period: "month", reset: String(Date.now()) } })} style={styles.category}>
        <View style={[styles.dot, { backgroundColor: palette[i] }]} /><Text variant="caption" color="textMuted" style={{ flex: 1 }}>{s.label}</Text><Text variant="caption">{sum > 0n ? (Number(s.amount * 10000n / sum) / 100).toFixed(1) : "0"}%</Text>
      </Pressable>)}</View>
    </View>}
  </HomeSection>;
}

export function WalletPanel({ wallets, message }: { wallets: Wallet[] | null; message: string }) {
  const { colors } = useTheme();
  const { amountsHidden } = usePrivacy();
  const styles = useStyles();
  return <HomeSection title="Your wallets" action={<HomeLink label="Manage" onPress={() => router.push("/wallets")} />}>
    {wallets === null ? <Text color="textMuted">{message}</Text> : !wallets.length ? <Text color="textMuted">No wallets yet. Add an account to start.</Text> : wallets.map((w) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${w.name}`} key={w.id} style={styles.walletRow} onPress={() => router.push("/wallets")}>
      <View style={styles.walletIcon}><Feather name={w.provider === "cash" ? "dollar-sign" : w.provider.includes("money") || w.provider.includes("momo") ? "smartphone" : "credit-card"} size={20} color={colors.accent} /></View>
      <View style={{ flex: 1, gap: 3 }}><Text variant="bodyStrong">{w.name}</Text><Text variant="caption" color="textMuted">{PROVIDER_LABEL[w.provider] ?? w.provider}{w.isPrimary ? " · Primary" : ""}</Text><Badge variant={w.balance.status === "confirmed" ? "positive" : w.balance.status === "estimated" ? "accent" : "neutral"}>{STATUS_LABEL[w.balance.status]}</Badge></View>
      <Text variant="bodyStrong" tabular style={{ maxWidth: "43%", textAlign: "right" }}>{amountsHidden ? "••••••" : w.balance.amountMinor === null ? "—" : formatMoney(w.balance.amountMinor, w.currency)}</Text>
    </Pressable>)}
  </HomeSection>;
}

const useStyles = makeStyles((c) => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  greeting: { flex: 1, fontSize: 24, lineHeight: 29, letterSpacing: -0.6 },
  iconButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 7, justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.surface },
  avatar: { minWidth: 44, minHeight: 44, borderRadius: 22, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
  notificationDot: { position: "absolute", width: 5, height: 5, right: 8, top: 8, backgroundColor: c.accent, borderRadius: 3 },
  hero: { padding: 20, borderRadius: 22, overflow: "hidden", gap: 12, backgroundColor: c.homeGradientStart },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  heroLabel: { flex: 1, fontSize: 14, lineHeight: 20, opacity: 0.9 },
  eye: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center", marginRight: -10, marginTop: -10, marginBottom: -10 },
  heroAmount: { fontSize: 31, lineHeight: 40, letterSpacing: -0.8 },
  heroActions: { flexDirection: "row", gap: 9, marginTop: 8 },
  addButton: { flex: 1.15, minHeight: 48, justifyContent: "center", alignItems: "center", padding: 8, borderRadius: 12, backgroundColor: c.onSolid },
  addLabel: { fontSize: 13, lineHeight: 18, color: c.homeGradientStart },
  walletButton: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", padding: 8, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.16)" },
  section: { padding: 18, gap: 16, borderRadius: 20 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  linkButton: { minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: c.background },
  cashColumns: { flexDirection: "row", gap: 16 },
  track: { height: 6, borderRadius: 3, backgroundColor: c.borderSubtle, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: c.chartIncome },
  breakdown: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  category: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  walletRow: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "space-between", padding: 12, minHeight: 68, borderRadius: 13, borderWidth: 1, borderColor: c.borderSubtle },
  walletIcon: { width: 34, height: 38, borderRadius: 10, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  spaceSheet: { padding: 20, borderRadius: 20, backgroundColor: c.background, gap: 16 },
}));
