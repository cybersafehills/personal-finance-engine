import { GuideAnchor } from "@/features/guides/GuideAnchor";
import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useEffect, useId, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useNavigationChrome } from "@/components/shell/NavigationChromeContext";
import { Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { STATUS_LABEL } from "@/features/wallets/display";
import type { Wallet } from "@/features/wallets/types";
import type { CurrentBalance } from "@/features/transactions/queries";
import { deviceStore } from "@/lib/device-store";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import { formatDateTime } from "@/lib/kigali-time";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { BalanceTrend } from "./BalanceTrend";
import { landingWalletKey, landingWallets } from "./wallet-order";

type Props = { wallets: Wallet[] | null; currency: SupportedCurrency; fallback: CurrentBalance | null; loading: boolean; preferenceScope?: string };
export function WalletCarousel({ wallets, fallback, loading, preferenceScope }: Props) {
  const styles = useStyles();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(1,Math.min(448,window.width-40)));
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
  const dotStart=Math.max(0,Math.min(selectedIndex-2,ordered.length-5));
  const visibleDots=ordered.slice(dotStart,dotStart+5);
  function choose(index: number) {
    interacted.current=true;
    setSelectedId(ordered[index].id);
    pager.current?.scrollTo({x:index*width,animated:true});
  }
  async function saveDefault(accountId:string) {
    if (!ordered.some(w=>w.id===accountId) || !preferenceScope || saving) return;
    interacted.current=true;
    setSaving(true);setError(null);
    try {
      await deviceStore.set(landingWalletKey(preferenceScope),accountId);
      setPreferredId(accountId);setSelectedId(accountId);
      pager.current?.scrollTo({x:0,animated:false});
    } catch { setError("Couldn’t save your default wallet. Try again."); }
    finally { setSaving(false); }
  }
  return <View style={{gap:4}} onLayout={({nativeEvent:{layout}}) => setWidth(Math.max(1,layout.width))}>
    {ordered.length>1?<View testID="wallet-controls" style={styles.controls}><Pressable accessibilityRole="button" accessibilityLabel="Next wallet" accessibilityHint="Swipe the card or tap to switch wallets" accessibilityValue={{text:`${selectedIndex+1} of ${ordered.length}: ${selected.name}`}} onPress={()=>choose((selectedIndex+1)%ordered.length)} hitSlop={{top:8,bottom:8}} style={styles.dots}>{visibleDots.map((w,i)=><View key={w.id} style={[styles.dot,i+dotStart===selectedIndex&&styles.activeDot]}/>)}</Pressable></View>:null}
    {ordered.length ? <ScrollView testID="wallet-carousel" ref={pager} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} onScrollBeginDrag={() => {interacted.current=true;}} contentOffset={{x:selectedIndex*width,y:0}} onMomentumScrollEnd={({nativeEvent}) => {interacted.current=true;const index=Math.max(0,Math.min(ordered.length-1,Math.round(nativeEvent.contentOffset.x/width)));setSelectedId(ordered[index].id);}}>
      {ordered.map((wallet,i) => <View key={wallet.id} style={{width}} accessibilityElementsHidden={i!==selectedIndex} importantForAccessibility={i===selectedIndex ? "auto" : "no-hide-descendants"}><WalletBalanceCard guideEnabled={i === selectedIndex} wallet={wallet} loading={loading} defaultOnLaunch={i===0} saving={saving} onMakeDefault={preferenceScope?()=>void saveDefault(wallet.id):undefined} /></View>)}
    </ScrollView> : <WalletBalanceCard fallback={wallets === null ? fallback : null} loading={loading} />}
    {error ? <Text variant="caption" color="attention">{error}</Text> : null}
  </View>;
}

function WalletBalanceCard({wallet,fallback,loading,defaultOnLaunch=false,saving=false,onMakeDefault,guideEnabled=true}:{guideEnabled?:boolean;wallet?:Wallet;fallback?:CurrentBalance|null;loading:boolean;defaultOnLaunch?:boolean;saving?:boolean;onMakeDefault?:()=>void}) {
  const styles=useStyles();
  const {colors}=useTheme();
  const {amountsHidden,toggleAmountsHidden}=usePrivacy();
  const {payOn,requestsOn}=useNavigationChrome();
  const [size,setSize]=useState({width:0,height:0});
  const id=useId().replace(/[^a-zA-Z0-9]/g,"");
  const amount=wallet ? wallet.balance.amountMinor : fallback ? BigInt(fallback.amountRwf) : null;
  const asOf=wallet ? wallet.balance.asOf : fallback?.asOfIso;
  const label=wallet?.name ?? (fallback ? "Last reported balance" : "Your wallet");
  const currency=wallet?.currency ?? "RWF";
  const money=amountsHidden ? "••••••" : amount !== null ? formatMoney(amount,currency) : loading ? "Loading…" : "—";
  // The currency code is set smaller than the figure; the text itself is unchanged.
  const prefix=money.startsWith(`${currency} `) ? `${currency} ` : "";
  const addButton=(round:boolean)=><GuideAnchor id="add-transaction" enabled={guideEnabled} style={round?undefined:{flex:1}}><Pressable accessibilityRole="button" accessibilityLabel={wallet ? `Add transaction to ${wallet.name}` : "Add transaction"} onPress={()=>router.push(wallet ? {pathname:"/add-transaction",params:{accountId:wallet.id}} : "/add-transaction")} style={({pressed})=>[styles.pill,round&&styles.round,pressed&&styles.pressed]}><Feather name="plus" size={20} color={colors.onSolid}/>{round?null:<Text variant="bodyStrong" color="onSolid">Add transaction</Text>}</Pressable></GuideAnchor>;
  return <View style={{gap:6}}>
    <GuideAnchor id="overview" enabled={guideEnabled}><View testID="balance-card" style={styles.card} onLayout={({nativeEvent:{layout}})=>setSize(old=>old.width===layout.width&&old.height===layout.height?old:{width:layout.width,height:layout.height})}>
      <Svg testID="balance-card-background" width={size.width} height={size.height} viewBox="0 0 360 220" preserveAspectRatio="none" style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none"><Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.homeGradientStart}/><Stop offset="1" stopColor={colors.homeGradientEnd}/></LinearGradient></Defs><Rect width={360} height={220} fill={`url(#${id})`}/><Path d="M150 0H220L360 140V210Z" fill={colors.onSolid} fillOpacity={0.05}/><Path d="M256 0H304L360 56V104Z" fill={colors.onSolid} fillOpacity={0.07}/></Svg>
      <View style={styles.cardTop}><Pressable accessibilityRole="button" accessibilityLabel={wallet ? `View ${wallet.name}` : "View wallets"} onPress={()=>router.push(wallet ? {pathname:"/wallet/[id]",params:{id:wallet.id}} : "/wallets")} style={styles.name}><Text variant="label" color="onSolid" numberOfLines={2} style={{flexShrink:1}}>{label}</Text><Feather name="chevron-right" size={16} color={colors.onSolid}/></Pressable>{wallet?<Pressable accessibilityRole="button" accessibilityLabel={defaultOnLaunch?`${wallet.name} is the default landing wallet`:`Use ${wallet.name} on launch`} disabled={defaultOnLaunch||saving||!onMakeDefault} onPress={onMakeDefault} style={styles.defaultButton}><Feather name="star" size={13} color={colors.onSolid}/><Text variant="caption" color="onSolid" style={{fontSize:11,lineHeight:15}}>{saving?"Saving…":defaultOnLaunch?"Default":"Set default"}</Text></Pressable>:null}<Pressable accessibilityRole="button" accessibilityLabel={amountsHidden ? "Show balances" : "Hide balances"} onPress={toggleAmountsHidden} style={styles.eye}><Feather name={amountsHidden ? "eye-off" : "eye"} size={20} color={colors.onSolid}/></Pressable></View>
      <Text variant="hero" color="onSolid" tabular adjustsFontSizeToFit numberOfLines={1}>{prefix?<Text variant="heading" color="onSolid">{prefix}</Text>:null}{money.slice(prefix.length)}</Text>
      {wallet?.balance.status === "confirmed" ? null : <Text variant="caption" color="onSolid">{wallet ? STATUS_LABEL[wallet.balance.status] : fallback ? "Single provider snapshot" : "No wallet balance available"}</Text>}
      {wallet ? <BalanceTrend wallet={wallet} hidden={amountsHidden}/> : null}
      {/* Pay and Request appear only where they are switched on for this account. */}
      <View style={styles.actions}>{payOn?<><Pressable accessibilityRole="button" accessibilityLabel="Pay" onPress={()=>router.push("/pay-sheet")} style={({pressed})=>[styles.pill,styles.split,pressed&&styles.pressed]}><Text variant="bodyStrong" color="onSolid">Pay</Text><Feather name="arrow-up-right" size={19} color={colors.onSolid}/></Pressable>{requestsOn?<Pressable accessibilityRole="button" accessibilityLabel="Request payment" onPress={()=>router.push("/request-new")} style={({pressed})=>[styles.pill,styles.split,pressed&&styles.pressed]}><Text variant="bodyStrong" color="onSolid">Request</Text><Feather name="arrow-down-left" size={19} color={colors.onSolid}/></Pressable>:null}{addButton(true)}</>:addButton(false)}</View>
    </View>
    </GuideAnchor><Text variant="caption" color="textMuted" style={styles.updatedAt}>{asOf ? `Last updated on ${formatDateTime(asOf)}` : "Balance freshness unavailable"}</Text>
    {!wallet && fallback?.pendingCount ? <Text variant="caption" color="attention">{fallback.pendingCount} local changes not yet confirmed</Text> : null}
  </View>;
}
const useStyles=makeStyles(c=>StyleSheet.create({
  controls:{alignItems:"center",justifyContent:"center",height:20},
  updatedAt:{paddingHorizontal:16,fontSize:11,lineHeight:15},
  dots:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:5,minWidth:44,height:20,paddingHorizontal:4},dot:{width:6,height:6,borderRadius:3,backgroundColor:c.borderStrong},activeDot:{width:18,backgroundColor:c.accent},
  defaultButton:{flexDirection:"row",alignItems:"center",gap:4,minHeight:44,paddingHorizontal:3},
  card:{paddingHorizontal:16,paddingTop:10,paddingBottom:16,borderRadius:24,borderCurve:"continuous",overflow:"hidden",gap:6,backgroundColor:c.homeGradientStart},cardTop:{flexDirection:"row",alignItems:"center",gap:8,paddingLeft:4},name:{flex:1,minHeight:44,flexDirection:"row",alignItems:"center",gap:2},eye:{width:44,height:44,alignItems:"center",justifyContent:"center",marginRight:-6},
  actions:{flexDirection:"row",gap:10,marginTop:12},pill:{minHeight:52,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,paddingHorizontal:18,borderRadius:999,borderWidth:1,borderColor:"rgba(255,255,255,0.22)",backgroundColor:"rgba(255,255,255,0.12)"},split:{flex:1,justifyContent:"space-between"},round:{width:52,paddingHorizontal:0},pressed:{backgroundColor:"rgba(255,255,255,0.22)"}
}));
