import * as Crypto from 'expo-crypto';
import { supabase } from '@/api/supabase';
import { parseAvatar, profilePatch, type Avatar, type Profile } from './model';
const BUCKET='profile-avatars';
export async function getProfile(userId: string, email: string): Promise<Profile> {
  if (!supabase) throw new Error('This build is not connected.');
  const {data,error}=await supabase.from('profiles').select('id,first_name,last_name,display_name,country_code,preferred_currency,timezone,locale,profile_avatar').eq('id',userId).single();
  if(error || !data) throw new Error('Could not load your profile. Try again.');
  const avatar=parseAvatar(data.profile_avatar,userId);
  let photoUrl:string|null=null;
  if(avatar.kind==='photo' && avatar.path){
    const signed=await supabase.storage.from(BUCKET).createSignedUrl(avatar.path,3600);
    photoUrl=signed.data?.signedUrl ?? null;
  }
  return {id:userId,firstName:data.first_name ?? '',lastName:data.last_name ?? '',name:data.display_name || [data.first_name,data.last_name].filter(Boolean).join(' ') || email,email,country:data.country_code ?? '',currency:data.preferred_currency,timezone:data.timezone,locale:data.locale,avatar,photoUrl};
}
/** JPEG bytes come from the resized image, not the original photo or its metadata. */
export function decodePhoto(base64:string):ArrayBuffer {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length%4!==0 || base64.length>2800000) throw new Error('Choose a smaller photo.');
  // Hermes and browsers have different global polyfills; decode bytes without relying on atob.
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding=base64.endsWith('==')?2:base64.endsWith('=')?1:0;
  const bytes=new Uint8Array(base64.length/4*3-padding);
  let bits=0,value=0,index=0;
  for(const char of base64.replace(/=+$/,'')){
    value=(value<<6)|alphabet.indexOf(char);bits+=6;
    if(bits>=8){bits-=8;bytes[index++]=(value>>bits)&255;value&=(1<<bits)-1;}
  }
  if(bytes[0]!==255 || bytes[1]!==216) throw new Error('Choose a JPEG photo.');
  return bytes.buffer;
}
export async function saveProfile(userId:string, first:string,last:string,avatar:Avatar,newPhoto:string|null):Promise<Avatar>{
  if(!supabase) throw new Error('This build is not connected.');
  const patch=profilePatch(first,last,avatar,userId);
  let uploaded:string|null=null;
  if(avatar.kind==='photo' && newPhoto){
    uploaded=`${userId}/${Crypto.randomUUID()}.jpg`;
    const {error}=await supabase.storage.from(BUCKET).upload(uploaded,decodePhoto(newPhoto),{contentType:'image/jpeg',upsert:false});
    if(error) throw new Error('Could not upload your photo. Your profile has not changed.');
    patch.profile_avatar={...avatar,path:uploaded,sticker:null};
  }
  if(avatar.kind==='photo' && !patch.profile_avatar.path) throw new Error('Choose a photo first.');
  const {data:before}=await supabase.from('profiles').select('profile_avatar').eq('id',userId).single();
  const previousPath=parseAvatar(before?.profile_avatar,userId).path;
  const {data,error}=await supabase.from('profiles').update(patch).eq('id',userId).select('id').single();
  if(error || !data){
    if(uploaded) await supabase.storage.from(BUCKET).remove([uploaded]);
    throw new Error('Could not save your profile. Please try again.');
  }
  if(previousPath && previousPath!==patch.profile_avatar.path) await supabase.storage.from(BUCKET).remove([previousPath]).catch(()=>undefined);
  return patch.profile_avatar;
}
