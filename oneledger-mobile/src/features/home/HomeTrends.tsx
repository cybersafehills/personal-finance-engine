import { useCallback,useState } from "react";
import { KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,View } from "react-native";
import { fetchInsights } from "@/api/mobile-api";
import { Button,Text,TextField } from "@/components/ds";
import { useQuery } from "@/hooks/useQuery";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { kigaliDateKey } from "@/lib/kigali-time";
import type { SupportedCurrency } from "@/lib/money";
import { currencyBlock } from "./live-data";
import { HomeSection } from "./HomeCards";
import { TrendChart } from "./Charts";
import { fillTrendWindow,trendWindow,type TrendRange } from "./trend-range";

export function HomeTrends({currency,scope,nowIso,day}:{currency:SupportedCurrency;scope:string;nowIso:string;day:string}){
 const now=new Date(nowIso);
 const {activeId}=useActiveSpace();const {colors}=useTheme();
 const [range,setRange]=useState<TrendRange>({kind:"months",months:6}),[open,setOpen]=useState(false),[from,setFrom]=useState(kigaliDateKey(new Date(now.getTime()-30*86400000).toISOString())),[to,setTo]=useState(kigaliDateKey(now.toISOString())),[error,setError]=useState<string|null>(null);
 const window=trendWindow(range,now);const key=JSON.stringify([activeId,day,range]);
 const load=useCallback(async()=>{
  if(!activeId||!day)throw new Error("Select a Space");
  const selected=trendWindow(range,new Date());
  return {key:JSON.stringify([activeId,day,range]),window:selected,result:await fetchInsights(selected)};
 },[activeId,range,day]);
 const query=useQuery(load,{refreshIntervalMs:60000});const data=query.data?.key===key?query.data:null;
 const block=currencyBlock(data?.result,currency);const points=data?.result.ok&&block?.trend?fillTrendWindow(block.trend,data.window):[];
 function apply(){try{const next:TrendRange={kind:"custom",from,to};trendWindow(next,now);setRange(next);setOpen(false);setError(null);}catch(e){setError(e instanceof Error?e.message:"Check your dates.");}}
 const action=<Pressable accessibilityRole="button" accessibilityLabel="Choose trend date range" onPress={()=>{setError(null);setOpen(true);}} style={{minHeight:44,paddingHorizontal:5,justifyContent:"center"}}><Text variant="caption" color="accent">{window.label} ⌄</Text></Pressable>;
 return <><HomeSection title="Cash flow trends" subtitle={`Income and expenses · ${currency}`} collapsible pinScope={scope} sectionId="trends" action={action} dense>
  {data?.result.ok?<TrendChart points={points} currency={currency} granularity={data.window.granularity}/>:<Text variant="caption" color="textMuted">{data&&!data.result.ok?data.result.message:query.error??"Loading your trend…"}</Text>}
  <Text variant="caption" color="textMuted" style={{fontSize:10,lineHeight:14}}>{kigaliDateKey(window.from)} – {kigaliDateKey(new Date(Date.parse(window.to)-1).toISOString())} · {window.granularity} buckets · selected dates only</Text>
 </HomeSection>
 <Modal transparent visible={open} animationType="fade" onRequestClose={()=>setOpen(false)}><View style={{flex:1,backgroundColor:"rgba(0,0,0,.4)",justifyContent:"center",padding:20}}><KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":"height"} style={{maxHeight:"90%"}}><ScrollView keyboardShouldPersistTaps="handled" style={{backgroundColor:colors.surface,borderRadius:18}} contentContainerStyle={{padding:18,gap:10}} accessibilityViewIsModal><Text variant="heading">Trend date range</Text><View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{[1,3,6,12].map(months=><Button key={months} label={`${months} month${months===1?"":"s"}`} size="sm" variant="secondary" onPress={()=>{setRange({kind:"months",months:months as 1|3|6|12});setOpen(false);}}/>)}</View><Text variant="caption" color="textMuted">Or choose dates (up to 400 days).</Text><TextField label="From date" placeholder="YYYY-MM-DD" value={from} onChangeText={setFrom} autoCapitalize="none"/><TextField label="To date" placeholder="YYYY-MM-DD" value={to} onChangeText={setTo} autoCapitalize="none"/>{error?<Text color="attention">{error}</Text>:null}<Button label="Apply dates" onPress={apply}/><Button label="Close date range" variant="ghost" onPress={()=>setOpen(false)}/></ScrollView></KeyboardAvoidingView></View></Modal></>;
}
