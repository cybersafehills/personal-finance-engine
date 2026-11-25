import { GuideAnchor } from "@/features/guides/GuideAnchor";
import { router,usePathname } from "expo-router";
import { useCallback,useEffect,useMemo,useState,type ReactNode } from "react";
import { Keyboard,Platform,StyleSheet,useWindowDimensions,View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated,{ReduceMotion,useAnimatedStyle,useSharedValue,withTiming} from "react-native-reanimated";
import { fetchPayConfig } from "@/api/mobile-api";
import { useQuery } from "@/hooks/useQuery";
import { setPayConfigCache } from "@/features/pay/config-cache";
import { holdHint,resolveHoldTarget } from "@/features/pay/hold-action";
import { useHoldPrefs } from "@/features/pay/hold-store";
import { showPayButton } from "@/features/pay/launcher";
import { useWarmMoreFlags } from "@/features/more/flags-cache";
import { NavigationChromeContext,useNavigationChrome } from "./NavigationChromeContext";
import { dockBottomGap,PAY_CENTRE_SCALE } from "./dockClearance";
import { isHomePath,isTabPath } from "./useChromeScroll";
import { Text } from "@/components/ds/Text";
import { MotionTabBar } from "./MotionTabBar";
import { PayTabButton } from "./PayTabButton";

export function NavigationChromeProvider({children}:{children:ReactNode}){
 const path=usePathname();const home=isHomePath(path),onTabs=isTabPath(path);
 const [scrollState,setScrollState]=useState({path,compact:false}),[keyboardHeight,setKeyboardHeight]=useState(0);
 const compact=scrollState.path===path&&scrollState.compact;
 const setCompact=useCallback((value:boolean)=>setScrollState(old=>old.path===path&&old.compact===value?old:{path,compact:value}),[path]);
 const compactProgress=useSharedValue(0),awayProgress=useSharedValue(onTabs?0:1);
 useEffect(()=>{compactProgress.set(withTiming(compact?1:0,{duration:180,reduceMotion:ReduceMotion.System}));},[compact,compactProgress]);
 useEffect(()=>{awayProgress.set(withTiming(onTabs?0:1,{duration:280,reduceMotion:ReduceMotion.System}));},[onTabs,awayProgress]);
 useEffect(()=>{const show=Keyboard.addListener(Platform.OS==="ios"?"keyboardWillShow":"keyboardDidShow",e=>setKeyboardHeight(e.endCoordinates.height));const hide=Keyboard.addListener(Platform.OS==="ios"?"keyboardWillHide":"keyboardDidHide",()=>setKeyboardHeight(0));return()=>{show.remove();hide.remove();};},[]);
 const load=useCallback(async()=>{const result=await fetchPayConfig();setPayConfigCache(result.ok?result:null);return result;},[]);
 useWarmMoreFlags();
 const {data}=useQuery(load,{refreshIntervalMs:60000});const payOn=data?showPayButton(data):false;
 const payConfig=payOn&&data?.ok?data:null;
 const value=useMemo(()=>({compact,home,onTabs,payOn,payConfig,keyboardHeight,compactProgress,awayProgress,setCompact}),[compact,home,onTabs,payOn,payConfig,keyboardHeight,compactProgress,awayProgress,setCompact]);
 return <NavigationChromeContext.Provider value={value}>{children}<GlobalNavigation/><GlobalPayButton config={data}/></NavigationChromeContext.Provider>;
}
function GlobalPayButton({config}:{config:Awaited<ReturnType<typeof fetchPayConfig>>|null}){
 const path=usePathname();const {width}=useWindowDimensions();const insets=useSafeAreaInsets();
 const {payOn,onTabs,keyboardHeight,compactProgress,awayProgress}=useNavigationChrome();
 const prefs=useHoldPrefs();const ready=config?.ok?config:null;const target=resolveHoldTarget(prefs,ready);
 const keyboard=useSharedValue(0);
 const gap=dockBottomGap(insets.bottom);
 useEffect(()=>{keyboard.set(withTiming(keyboardHeight,{duration:180,reduceMotion:ReduceMotion.System}));},[keyboard,keyboardHeight]);
 const animated=useAnimatedStyle(()=>{const away=awayProgress?.get()??0,c=compactProgress?.get()??0;return {left:(width-48)/2+(width-insets.right-16-48-(width-48)/2)*away,bottom:Math.max(keyboard.get()+18,gap+28-8*c),transform:[{scale:(1+(PAY_CENTRE_SCALE-1)*(1-away))*(1-0.06*c)}]};});
 const labelStyle=useAnimatedStyle(()=>({opacity:(1-(compactProgress?.get()??0))*(1-(awayProgress?.get()??0))}));
 const hidden=keyboardHeight>0||["/pay-sheet","/scan","/connect"].includes(path)||path.startsWith("/pay-new")||path.startsWith("/pay-again");
 if(!payOn||hidden)return null;
 return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}><Animated.View testID="global-pay-position" style={[styles.floating,animated]}><GuideAnchor persistent id="pay-launcher"><PayTabButton floating onPress={()=>{Keyboard.dismiss();router.push("/pay-sheet");}} onHold={target?()=>{Keyboard.dismiss();router.push(target);}:undefined} holdMs={prefs.durationMs} hint={holdHint(prefs,ready)}/></GuideAnchor>{onTabs?<Animated.View accessibilityElementsHidden style={[{position:"absolute",top:54,width:48,alignItems:"center"},labelStyle]}><Text variant="caption" color="textPrimary" style={{fontSize:11,lineHeight:14}}>Pay</Text></Animated.View>:null}</Animated.View></View>;
}
const styles=StyleSheet.create({floating:{position:"absolute",width:48,height:48,zIndex:100,elevation:20}});

function GlobalNavigation() {
 const path = usePathname();
 const { keyboardHeight, onTabs, awayProgress } = useNavigationChrome();
 const transition = useAnimatedStyle(() => {
   const away = awayProgress?.get() ?? 0;
   return { opacity: 1 - away, transform: [{ translateY: 14 * away }], display: away >= 1 ? "none" : "flex" };
 });
 if (keyboardHeight > 0 || ["/pay-sheet", "/scan", "/connect"].includes(path) || path.startsWith("/pay-new") || path.startsWith("/pay-again")) return null;
 return <Animated.View testID="navigation-dock" pointerEvents={onTabs ? "box-none" : "none"} accessibilityElementsHidden={!onTabs} importantForAccessibility={onTabs ? "auto" : "no-hide-descendants"} style={[{position:"absolute",left:0,right:0,bottom:0,zIndex:90}, transition]}><MotionTabBar/></Animated.View>;
}
