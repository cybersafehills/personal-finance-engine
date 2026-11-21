import { useCallback,useRef,useEffect } from "react";
import type { NativeScrollEvent,NativeSyntheticEvent } from "react-native";
import { useNavigationChrome } from "./NavigationChromeContext";

export function scrollChromeMode(anchor:number,y:number):boolean|null {
 if(y<24||y-anchor<-12)return false;
 if(y>72&&y-anchor>16)return true;
 return null;
}
export function useChromeScroll(){
 const {setCompact}=useNavigationChrome();const anchor=useRef(0);
 useEffect(()=>{anchor.current=0;setCompact(false);},[setCompact]);
 return useCallback((event:NativeSyntheticEvent<NativeScrollEvent>)=>{const y=Math.max(0,event.nativeEvent.contentOffset.y);const next=scrollChromeMode(anchor.current,y);if(next!==null){anchor.current=y;setCompact(next);}},[setCompact]);
}
export const isHomePath=(path:string)=>path==="/"||path==="/index";
export const isTabPath=(path:string)=>isHomePath(path)||["/transactions","/more","/plan","/pay","/inbox"].includes(path);
