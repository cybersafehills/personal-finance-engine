import Feather from '@expo/vector-icons/Feather';
import {router} from 'expo-router';
import {Pressable,View} from 'react-native';
import {Button,Card,ScreenHeader,Text} from '@/components/ds';
import {useTheme} from '@/theme/ThemeProvider';
import {usePrivacy} from '@/features/privacy/PrivacyProvider';
import {formatMoney} from '@/lib/money';
import type {PreviewTotal} from '@/features/statements/generation';
export function DocumentsHeader({tab}:{tab:'reports'|'statements'}){
 const {colors}=useTheme();
 return <><ScreenHeader title="Documents" action={<Button label="Schedule" size="sm" variant="ghost" onPress={()=>router.push('/report-settings')}/>}/><View accessibilityRole="tablist" style={{flexDirection:'row',padding:4,gap:4,backgroundColor:colors.borderSubtle,borderRadius:12}}>{(['reports','statements'] as const).map(item=><Pressable key={item} accessibilityRole="tab" accessibilityLabel={item==='reports'?'Reports':'Statements'} accessibilityState={{selected:item===tab}} onPress={()=>router.navigate(item==='reports'?'/reports':'/statements')} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:9,backgroundColor:tab===item?colors.surface:'transparent'}}><Text variant="bodyStrong" style={{fontSize:13}}>{item==='reports'?'Reports':'Statements'}</Text></Pressable>)}</View></>;
}
export function DocumentHero({title,detail,action,onPress}:{title:string;detail:string;action:string;onPress():void}){
 const {colors}=useTheme();return <Card style={{gap:8,padding:16,backgroundColor:colors.homeGradientStart,borderColor:colors.homeGradientStart}}><Text variant="heading" color="onSolid" style={{fontSize:18,lineHeight:24}}>{title}</Text><Text variant="caption" color="onSolid" style={{opacity:.85}}>{detail}</Text><Button label={action} onPress={onPress} fullWidth variant="secondary"/></Card>;
}
export function DocumentTotals({totals}:{totals:PreviewTotal[]}){
 const {amountsHidden}=usePrivacy();
 return <View style={{gap:10}}>{totals.map(t=>{
 const money=(v:number|null)=>amountsHidden?'••••••':v===null?'—':['RWF','USD','EUR'].includes(t.currency)?formatMoney(BigInt(v),t.currency as 'RWF'|'USD'|'EUR'):`${t.currency} ${v} minor units`;
 return <View key={t.currency} style={{gap:8}}>{totals.length>1?<Text variant="bodyStrong">{t.currency}</Text>:null}<View style={{flexDirection:'row',gap:12}}>{[{label:'Money in',value:t.totalCreditsMinor,color:'moneyPositive' as const},{label:'Money out',value:t.totalDebitsMinor,color:'danger' as const}].map(x=><View key={x.label} style={{flex:1,gap:3}}><Text variant="caption" color="textMuted">{x.label}</Text><Text variant="bodyStrong" color={x.color} tabular style={{fontSize:14}}>{money(x.value)}</Text></View>)}</View><Text variant="caption" color="textMuted">Opening {money(t.openingBalanceMinor)} · Closing {money(t.closingBalanceMinor)}</Text><Text variant="caption" color="textMuted">Fees {money(t.totalFeesMinor)} · {t.transactionCount} transactions</Text>{t.reconciles===false?<Text variant="caption" color="attention">The recorded balances do not reconcile. Review the coverage notes.</Text>:null}</View>;
 })}</View>;
}
export function DocumentChevron(){const {colors}=useTheme();return <Feather name="chevron-right" size={16} color={colors.textMuted}/>;}
