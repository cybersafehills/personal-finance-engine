import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useEffect, useId, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import type { Wallet } from "@/features/wallets/types";
import { STATUS_LABEL } from "@/features/wallets/display";
import type { CurrentBalance } from "@/features/transactions/queries";
import { deviceStore } from "@/lib/device-store";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import { formatDateTime } from "@/lib/kigali-time";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { landingWalletKey, landingWallets } from "./wallet-order";

type Props = { wallets: Wallet[] | null; currency: SupportedCurrency; fallback: CurrentBalance | null; loading: boolean; preferenceScope?: string };
export function WalletCarousel({ wallets, fallback, loading, preferenceScope }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(1,Math.min(448,window.width-32)));
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interacted = useRef(false);
  const pager = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (!preferenceScope) return;
    let active = true;
    void deviceStore.get(landingWalletKey(preferenceScope)).then(value => {
      if (!active || interacted.current) return;
      setPreferredId(value);
      setSelectedId(value);
    }).catch(() => {});
    return () => { active=false; };
  },[preferenceScope]);
  const ordered = landingWallets(wallets ?? [],preferredId);
  const selectedIndex = Math.max(0,ordered.findIndex(w => w.id === selectedId));
  const selected = ordered[selectedIndex];
  const isDefault = selectedIndex === 0;
  function choose(index: number) {
    interacted.current=true;
    setSelectedId(ordered[index].id);
    pager.current?.scrollTo({x:index*width,animated:true});
  }
  async function saveDefault() {
    if (!selected || !preferenceScope || saving) return;
    interacted.current=true;
    setSaving(true);setError(null);
    try {
      await deviceStore.set(landingWalletKey(preferenceScope),selected.id);
      setPreferredId(selected.id);setSelectedId(selected.id);
      pager.current?.scrollTo({x:0,animated:false});
    } catch { setError("Couldn’t save your default wallet. Try again."); }
    finally { setSaving(false); }
  }
  return <View style={{gap:4}} onLayout={({nativeEvent:{layout}}) => setWidth(Math.max(1,layout.width))}>
    {ordered.length > 0 ? <View style={styles.controls}>
      <View style={styles.dots}>{ordered.map((w,i) => <Pressable key={w.id} accessibilityRole="button" accessibilityLabel={`Show ${w.name}`} accessibilityState={{selected:i===selectedIndex}} onPress={() => choose(i)} hitSlop={{top:8,bottom:8}} style={styles.dotTarget}><View style={[styles.dot,i===selectedIndex && styles.activeDot]} /></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={isDefault ? `${selected.name} is the default landing wallet` : `Use ${selected.name} on launch`} disabled={isDefault || saving || !preferenceScope} onPress={() => void saveDefault()} hitSlop={{top:8,bottom:8}} style={styles.defaultButton}><Feather name="star" size={13} color={colors.accent} /><Text variant="caption" color="accent">{saving ? "Saving…" : isDefault ? "Default" : "Make default"}</Text></Pressable>
    </View> : null}
    {ordered.length ? <ScrollView testID="wallet-carousel" ref={pager} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} onScrollBeginDrag={() => {interacted.current=true;}} contentOffset={{x:selectedIndex*width,y:0}} onMomentumScrollEnd={({nativeEvent}) => {interacted.current=true;const index=Math.max(0,Math.min(ordered.length-1,Math.round(nativeEvent.contentOffset.x/width)));setSelectedId(ordered[index].id);}}>
      {ordered.map((wallet,i) => <View key={wallet.id} style={{width}} accessibilityElementsHidden={i!==selectedIndex} importantForAccessibility={i===selectedIndex ? "auto" : "no-hide-descendants"}><WalletBalanceCard wallet={wallet} loading={loading} /></View>)}
    </ScrollView> : <WalletBalanceCard fallback={wallets === null ? fallback : null} loading={loading} />}
    {error ? <Text variant="caption" color="attention">{error}</Text> : null}
  </View>;
}

function WalletBalanceCard({wallet,fallback,loading}:{wallet?:Wallet;fallback?:CurrentBalance|null;loading:boolean}) {
  const styles=useStyles();
  const {colors}=useTheme();
  const {amountsHidden,toggleAmountsHidden}=usePrivacy();
  const [size,setSize]=useState({width:0,height:0});
  const id=useId().replace(/[^a-zA-Z0-9]/g,"");
  const amount=wallet ? wallet.balance.amountMinor : fallback ? BigInt(fallback.amountRwf) : null;
  const asOf=wallet ? wallet.balance.asOf : fallback?.asOfIso;
  const label=wallet?.name ?? (fallback ? "Last reported balance" : "Your wallet");
  return <View style={{gap:5}}>
    <View testID="balance-card" style={styles.card} onLayout={({nativeEvent:{layout}})=>setSize(old=>old.width===layout.width&&old.height===layout.height?old:{width:layout.width,height:layout.height})}>
      <Svg testID="balance-card-background" width={size.width} height={size.height} viewBox="0 0 360 190" preserveAspectRatio="none" style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none"><Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.homeGradientStart}/><Stop offset="1" stopColor={colors.homeGradientEnd}/></LinearGradient></Defs><Rect width={360} height={190} fill={`url(#${id})`}/><Circle cx={300} cy={-30} r={210} fill="none" stroke={colors.onSolid} strokeOpacity={0.07} strokeWidth={40}/><Circle cx={300} cy={-30} r={180} fill="none" stroke={colors.onSolid} strokeOpacity={0.12}/></Svg>
      <View style={styles.cardTop}><Text variant="bodyStrong" color="onSolid" numberOfLines={2} style={{flex:1}}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={amountsHidden ? "Show balances" : "Hide balances"} onPress={toggleAmountsHidden} style={styles.eye}><Feather name={amountsHidden ? "eye-off" : "eye"} size={18} color={colors.onSolid}/></Pressable></View>
      <Text variant="display" color="onSolid" tabular adjustsFontSizeToFit numberOfLines={1} style={styles.amount}>{amountsHidden ? "••••••" : amount !== null ? formatMoney(amount,wallet?.currency ?? "RWF") : loading ? "Loading…" : "—"}</Text>
      <Text variant="caption" color="onSolid">{wallet ? STATUS_LABEL[wallet.balance.status] : fallback ? "Single provider snapshot" : "No wallet balance available"}</Text>
      <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel={wallet ? `Add transaction to ${wallet.name}` : "Add transaction"} onPress={()=>router.push(wallet ? {pathname:"/add-transaction",params:{accountId:wallet.id}} : "/add-transaction")} style={styles.add}><Text variant="label" style={{color:colors.homeGradientStart}}>+ Add transaction</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={wallet ? `View ${wallet.name}` : "View wallets"} onPress={()=>router.push(wallet ? {pathname:"/wallet/[id]",params:{id:wallet.id}} : "/wallets")} style={styles.details}><Text variant="label" color="onSolid">{wallet ? "View wallet ↗" : "View wallets ↗"}</Text></Pressable></View>
    </View>
    <Text variant="caption" color="textMuted">{asOf ? `As of ${formatDateTime(asOf)}` : "Balance freshness unavailable"}</Text>
    {!wallet && fallback?.pendingCount ? <Text variant="caption" color="attention">{fallback.pendingCount} local changes not yet confirmed</Text> : null}
  </View>;
}
const useStyles=makeStyles(c=>StyleSheet.create({
  controls:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",minHeight:28},
  dots:{flexDirection:"row",alignItems:"center"},dotTarget:{width:44,minHeight:28,alignItems:"center",justifyContent:"center"},dot:{width:6,height:6,borderRadius:3,backgroundColor:c.borderStrong},activeDot:{width:18,backgroundColor:c.accent},
  defaultButton:{flexDirection:"row",alignItems:"center",gap:5,minHeight:28,paddingHorizontal:4},
  card:{padding:16,borderRadius:22,overflow:"hidden",gap:7,backgroundColor:c.homeGradientStart},cardTop:{flexDirection:"row",alignItems:"center",gap:8},eye:{width:44,height:36,alignItems:"center",justifyContent:"center",marginRight:-8,marginTop:-4,marginBottom:-4},
  amount:{fontSize:29,lineHeight:36,letterSpacing:-0.8},actions:{flexDirection:"row",gap:8,marginTop:8},add:{flex:1.2,minHeight:44,alignItems:"center",justifyContent:"center",padding:6,borderRadius:12,backgroundColor:c.onSolid},details:{flex:1,minHeight:44,alignItems:"center",justifyContent:"center",padding:6,borderRadius:12,backgroundColor:"rgba(255,255,255,0.16)"}
}));
