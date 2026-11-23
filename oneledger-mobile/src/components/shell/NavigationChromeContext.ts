import { createContext,useContext } from "react";
import type { SharedValue } from "react-native-reanimated";
export type NavigationChromeValue={compact:boolean;home:boolean;onTabs:boolean;payOn:boolean;keyboardHeight:number;compactProgress:SharedValue<number>|null;awayProgress:SharedValue<number>|null;setCompact(value:boolean):void};
export const NavigationChromeContext=createContext<NavigationChromeValue>({compact:false,home:true,onTabs:true,payOn:false,keyboardHeight:0,compactProgress:null,awayProgress:null,setCompact:()=>{}});
export const useNavigationChrome=()=>useContext(NavigationChromeContext);
