import { useEffect,useRef,useState } from "react";
import { deviceStore } from "@/lib/device-store";

export function usePinnedSection(scope:string|undefined,id:string|undefined) {
  const [pinned,setPinned]=useState(true),[expanded,setExpanded]=useState(true),[error,setError]=useState<string|null>(null);
  const touched=useRef(false);
  const key=scope && id ? `ol.home.pin.v1.${scope}.${id}` : null;
  useEffect(()=>{if(!key)return;let active=true;void deviceStore.get(key).then(raw=>{if(active&&!touched.current){const value=raw!=="false";setPinned(value);setExpanded(value);}}).catch(()=>{});return()=>{active=false;};},[key]);
  function pin(next:boolean){touched.current=true;setPinned(next);setExpanded(next);setError(null);if(key)void deviceStore.set(key,String(next)).catch(()=>setError("Couldn’t save this pin preference."));}
  function toggle(){if(expanded)pin(false);else{touched.current=true;setExpanded(true);}}
  return {pinned,expanded,error,pin,toggle};
}
