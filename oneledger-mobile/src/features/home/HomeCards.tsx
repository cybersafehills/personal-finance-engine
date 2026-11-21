import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Card, Text } from "@/components/ds";
import type { CurrencyOverview } from "@/features/insights/types";
import type { Wallet } from "@/features/wallets/types";
import { STATUS_LABEL, PROVIDER_LABEL } from "@/features/wallets/display";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { compactMoney, greeting } from "./live-data";
import { Donut } from "./Charts";

export function HomeHeader({ name, now, unread }: { name: string; now: Date; unread: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return <View testID="home-header">
    <View style={styles.header}>
      <View style={{flex:1,minHeight:44,justifyContent:"center",gap:2}}>
        <Text variant="caption" color="textMuted" style={styles.salutation}>{greeting(now.getHours())}</Text>
        <Text variant="bodyStrong" accessibilityRole="header" style={styles.greeting} numberOfLines={1}>{name.split(/\s+/)[0]}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 2 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Search transactions" onPress={() => router.navigate("/transactions")} style={styles.iconButton}><Feather name="search" size={17} color={colors.textPrimary} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push("/notifications")} style={styles.iconButton}><Feather name="bell" size={17} color={colors.textPrimary} />{unread > 0 ? <View style={styles.notificationDot} /> : null}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => router.push("/settings")} style={styles.avatar}><Text variant="bodyStrong" color="accent">{name.slice(0, 1).toUpperCase()}</Text></Pressable>
      </View>
    </View>

  </View>;
}

export function HomeSection({ title, subtitle, action, children, collapsible = false, dense = false }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; collapsible?: boolean; dense?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const heading = <View style={{ flex: 1, gap: 3 }}><Text variant="heading" style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text variant="caption" color="textMuted" style={styles.small}>{subtitle}</Text> : null}</View>;
  return <Card style={[styles.section,dense && styles.denseSection]}>
    {collapsible ? <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.collapseHeader}>{heading}<Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} /></Pressable> : <View style={styles.sectionHeading}>{heading}{action}</View>}
    {!collapsible || expanded ? <>{collapsible && action ? <View style={{ alignItems: "flex-end" }}>{action}</View> : null}{children}</> : null}
  </Card>;
}
export function HomeLink({ label, onPress }: { label: string; onPress(): void }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><Text variant="caption" color="textMuted">{label} →</Text></Pressable>;
}

export { WalletCarousel as HeroBalance } from "./WalletCarousel";

export function CashFlow({ currency, current, today, todayAvailable, available, message }: { today: CurrencyOverview | null; todayAvailable: boolean; currency: SupportedCurrency; current: CurrencyOverview | null; available: boolean; message: string }) {
  const { amountsHidden } = usePrivacy();
  const styles = useStyles();
  const money = (amount: bigint, ready: boolean) => amountsHidden ? "••••••" : ready ? compactMoney(amount,currency) : "—";
  return <HomeSection title="Cash flow" dense action={<Text variant="caption" color="textMuted">{currency}</Text>}>
    <View style={styles.dailyPrimary}>{[{label:"Received today",amount:today?.moneyInMinor ?? 0n,positive:true},{label:"Spent today",amount:today?.moneyOutMinor ?? 0n,positive:false}].map(item => <View key={item.label} style={{flex:1,gap:5}}><Text variant="caption" color="textMuted">{item.label}</Text><Text variant="title" style={styles.dailyAmount} color={item.positive ? "moneyPositive" : "moneyRequest"} tabular adjustsFontSizeToFit numberOfLines={1}>{money(item.amount,todayAvailable)}</Text></View>)}</View>
    {!todayAvailable ? <Text variant="caption" color="textMuted">Today’s activity is unavailable.</Text> : null}
    <View style={styles.monthlyFooter}><Text variant="caption" color="textMuted" style={styles.small}>This month · Settled activity</Text>
      {available ? <View style={styles.cashColumns}>{[{label:"Income",amount:current?.moneyInMinor ?? 0n},{label:"Expenses",amount:current?.moneyOutMinor ?? 0n}].map(item => <View key={item.label} style={{flex:1,flexDirection:"row",flexWrap:"wrap",alignItems:"baseline",gap:5}}><Text variant="caption" color="textMuted" style={styles.small}>{item.label}</Text><Text variant="bodyStrong" style={styles.monthlyAmount} tabular>{money(item.amount,true)}</Text></View>)}</View> : <Text variant="caption" color="textMuted">{message}</Text>}
    </View>
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
  return <HomeSection title="Spending breakdown" subtitle="Where your money goes" collapsible>
    {!available ? <Text color="textMuted">{message}</Text> : !rows.length ? <Text color="textMuted">Your spending categories appear after your first settled expense.</Text> : negative ? <><Text color="textMuted">Net spending includes refunds.</Text>{rows.map((r) => <View key={r.category} style={styles.walletRow}><Text>{r.category}</Text><Text>{amountsHidden ? "••••••" : formatMoney(r.amountMinor, currency)}</Text></View>)}</> : <View style={styles.breakdown}>
      <Donut slices={slices.map((s, i) => ({ ...s, color: palette[i] }))} total={<><Text variant="heading" tabular>{amountsHidden ? "••••" : compactMoney(current?.moneyOutMinor ?? sum, currency).replace(currency + " ", "")}</Text><Text variant="caption" color="textMuted">Total spent</Text></>} />
      <View style={{ flex: 1, gap: 6 }}>{slices.map((s, i) => <Pressable key={s.label} accessibilityRole="button" accessibilityLabel={`${s.label}, ${amountsHidden ? "amount hidden" : formatMoney(s.amount, currency)}`} onPress={() => router.navigate({ pathname: "/transactions", params: { category: s.category ?? "", accountId:"", walletName:"", period: "month", reset: String(Date.now()) } })} style={styles.category}>
        <View style={[styles.dot, { backgroundColor: palette[i] }]} /><Text variant="caption" color="textMuted" style={{ flex: 1 }}>{s.label}</Text><Text variant="caption">{sum > 0n ? (Number(s.amount * 10000n / sum) / 100).toFixed(1) : "0"}%</Text>
      </Pressable>)}</View>
    </View>}
  </HomeSection>;
}

export function WalletPanel({ wallets, message, manage = true }: { wallets: Wallet[] | null; message: string; manage?: boolean }) {
  const { colors } = useTheme();
  const { amountsHidden } = usePrivacy();
  const styles = useStyles();
  return <HomeSection title="Your wallets" action={manage ? <HomeLink label="Manage" onPress={() => router.push("/wallets")} /> : undefined}>
    {wallets === null ? <Text color="textMuted">{message}</Text> : !wallets.length ? <Text color="textMuted">No wallets yet. Add an account to start.</Text> : wallets.map((w) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${w.name}`} key={w.id} style={styles.walletRow} onPress={() => router.push({pathname:"/wallet/[id]",params:{id:w.id}})}>
      <View style={styles.walletIcon}><Feather name={w.provider === "cash" ? "dollar-sign" : w.provider.includes("money") || w.provider.includes("momo") ? "smartphone" : "credit-card"} size={18} color={colors.accent} /></View>
      <View style={{ flex: 1, gap: 5 }}><View style={styles.walletTop}><Text variant="bodyStrong" numberOfLines={2} style={styles.walletName}>{w.name}</Text><Text variant="bodyStrong" tabular style={styles.walletAmount}>{amountsHidden ? "••••••" : w.balance.amountMinor === null ? "—" : formatMoney(w.balance.amountMinor, w.currency)}</Text></View><Text variant="caption" color="textMuted" style={styles.small}>{PROVIDER_LABEL[w.provider] ?? w.provider} · {STATUS_LABEL[w.balance.status]}</Text></View>
      <Feather name="chevron-right" size={15} color={colors.textMuted} />
    </Pressable>)}
  </HomeSection>;
}

const useStyles = makeStyles((c) => StyleSheet.create({
  denseSection: { padding:14,gap:6 },
  dailyPrimary: { flexDirection:"row",gap:12,paddingVertical:4 },
  dailyAmount: { fontSize:22,lineHeight:28 },
  monthlyFooter: { borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.borderSubtle,paddingTop:8,gap:4 },
  monthlyAmount: { fontSize:13,lineHeight:18 },
  sectionTitle: { fontSize: 15, lineHeight: 20 },
  small: { fontSize: 11, lineHeight: 15 },
  collapseHeader: { flexDirection:"row", alignItems:"center", gap:8, minHeight:44 },
  walletTop: { flexDirection:"row", flexWrap:"wrap", alignItems:"baseline", gap:6 },
  walletName: { flexGrow:1, flexBasis:110, fontSize:13, lineHeight:18 },
  walletAmount: { fontSize:13, lineHeight:18, flexShrink:1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  greeting: { fontSize:17, lineHeight:22 },
  salutation: { fontSize:12, lineHeight:16 },
  iconButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 4, justifyContent: "center", alignItems: "center", borderRadius: 12 },
  avatar: { minWidth: 44, minHeight: 44, borderRadius: 22, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
  notificationDot: { position: "absolute", width: 5, height: 5, right: 8, top: 8, backgroundColor: c.accent, borderRadius: 3 },
  section: { padding: 16, gap: 12, borderRadius: 18 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  linkButton: { minHeight: 44, paddingHorizontal: 4, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: c.background },
  cashColumns: { flexDirection: "row", gap: 12 },
  breakdown: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  category: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  walletRow: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "space-between", padding: 12, minHeight: 68, borderRadius: 13, borderWidth: 1, borderColor: c.borderSubtle },
  walletIcon: { width: 34, height: 38, borderRadius: 10, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
}));
