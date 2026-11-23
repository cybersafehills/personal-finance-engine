import { useState } from 'react';
import { Image,View } from 'react-native';
import { Text } from '@/components/ds';
import { AVATAR_COLORS,DEFAULT_AVATAR,STICKERS,initials,type Avatar as AvatarValue } from './model';
import { useProfile } from './ProfileProvider';
export function Avatar({name,size=44,avatar=DEFAULT_AVATAR,photoUrl}:{name:string;size?:number;avatar?:AvatarValue;photoUrl?:string|null}){
  const [failed,setFailed]=useState<string|null>(null);
  const c=AVATAR_COLORS[avatar.color] ?? AVATAR_COLORS.indigo;
  const sticker=STICKERS.find(s=>s.id===avatar.sticker);
  return <View accessible={false} style={{width:size,height:size,borderRadius:size/2,backgroundColor:c.bg,alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
    {avatar.kind==='photo' && photoUrl && failed!==photoUrl ? <Image source={{uri:photoUrl}} onError={()=>setFailed(photoUrl)} style={{width:size,height:size}} resizeMode="cover"/> : <Text style={{color:c.ink,fontSize:avatar.kind==='sticker'?size*0.49:size*0.36,lineHeight:size*0.7,fontFamily:avatar.kind==='sticker'?undefined:'Geist_600SemiBold'}}>{avatar.kind==='sticker' && sticker?sticker.glyph:initials(name)}</Text>}
  </View>;
}
export function AccountAvatar({fallbackName='Your account',size=44}:{fallbackName?:string;size?:number}){
  const state=useProfile();
  return <Avatar name={state?.profile?.name || fallbackName} size={size} avatar={state?.profile?.avatar} photoUrl={state?.profile?.photoUrl}/>;
}
