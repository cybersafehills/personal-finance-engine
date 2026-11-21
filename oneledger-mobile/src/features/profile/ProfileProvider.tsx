import { createContext,useContext,useCallback,useEffect,useRef,useState,type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useSession } from '@/features/auth/SessionProvider';
import { getProfile } from './service';
import type { Profile } from './model';
const ProfileContext=createContext<{profile:Profile|null;loading:boolean;error:string|null;refresh():Promise<void>} | null>(null);
export function ProfileProvider({children}:{children:ReactNode}){
  const {session}=useSession();const id=session?.user.id,email=session?.user.email ?? '';
  const request=useRef(0);
  const [snapshot,setSnapshot]=useState<Profile|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{
    if(!id)return;
    const current=++request.current;
    try{const p=await getProfile(id,email);if(current===request.current){setSnapshot(p);setError(null);}}
    catch(e){if(current===request.current)setError(e instanceof Error?e.message:'Could not load your profile.');}
    finally{if(current===request.current)setLoading(false);}
  },[id,email]);
  useEffect(()=>{
    let mounted=true;
    const generation=request;
    void Promise.resolve().then(()=>{if(mounted)void refresh();});
    const sub=AppState.addEventListener('change',s=>{if(s==='active')void refresh();});
    return()=>{mounted=false;generation.current++;sub.remove();};
  },[refresh]);
  const profile=snapshot?.id===id?snapshot:null;
  return <ProfileContext.Provider value={{profile,loading,error,refresh}}>{children}</ProfileContext.Provider>;
}
export const useProfile=()=>useContext(ProfileContext);
