import Feather from "@expo/vector-icons/Feather";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable,StyleSheet,useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated,{useAnimatedStyle} from "react-native-reanimated";
import { Text } from "@/components/ds";
import { useTheme } from "@/theme/ThemeProvider";
import { useNavigationChrome } from "./NavigationChromeContext";

type TabProps=Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
const routes=[{name:"index",label:"Home",icon:"home",home:0,away:1},{name:"transactions",label:"Transactions",icon:"list",home:1,away:2},{name:"plan",label:"Plan",icon:"target",home:3,away:3},{name:"more",label:"More",icon:"grid",home:4,away:4}] as const;
export function MotionTabBar(props:TabProps){
 const {colors}=useTheme();const {width}=useWindowDimensions();const insets=useSafeAreaInsets();const {compactProgress,keyboardHeight,payOn}=useNavigationChrome();
 const style=useAnimatedStyle(()=>({height:keyboardHeight>0?0:56-12*(compactProgress?.get()??0)+insets.bottom}));
 return <Animated.View accessibilityLabel="Main navigation" style={[{backgroundColor:colors.surface,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.borderSubtle,overflow:"hidden"},style]}>{routes.map((item,i)=><MotionTab key={item.name} item={item} position={i} width={width/(payOn?5:4)} {...props}/>)}</Animated.View>;
}
function MotionTab({item,position,width,state,emitter,navigateToTab}:TabProps&{item:typeof routes[number];position:number;width:number}){
 const {colors}=useTheme();const {awayProgress,compactProgress,payOn,compact}=useNavigationChrome();
 const route=state.routes.find(r=>r.name===item.name);const focused=state.routes[state.index]?.name===item.name;
 const style=useAnimatedStyle(()=>{const away=awayProgress?.get()??0;return {left:width*(payOn?item.home+(item.away-item.home)*away:position)};});
 const labelStyle=useAnimatedStyle(()=>({opacity:1-(compactProgress?.get()??0),height:14*(1-(compactProgress?.get()??0))}));
 if(!route)return null;
 return <Animated.View style={[{position:"absolute",top:0,width},style]}><Pressable accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{selected:focused}} onPress={()=>{const e=emitter.emit({type:"tabPress",target:route.key,canPreventDefault:true});if(!focused&&!e.defaultPrevented)navigateToTab(route.key);}} onLongPress={()=>emitter.emit({type:"tabLongPress",target:route.key})} style={{minHeight:44,alignItems:"center",justifyContent:"center",paddingTop:5,gap:3}}><Feather name={item.icon} size={20} color={focused?colors.accent:colors.textMuted}/><Animated.View style={labelStyle} accessibilityElementsHidden={compact}><Text variant="caption" style={{fontSize:10,lineHeight:14}} color={focused?"accent":"textMuted"}>{item.label}</Text></Animated.View></Pressable></Animated.View>;
}
