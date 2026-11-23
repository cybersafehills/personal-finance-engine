import Feather from '@expo/vector-icons/Feather';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useRef,useState } from 'react';
import { Pressable,View } from 'react-native';
import { Button,Card,Chip,Screen,ScreenHeader,Text,TextField } from '@/components/ds';
import { Avatar } from '@/features/profile/Avatar';
import { AVATAR_COLORS,STICKERS,type Avatar as AvatarValue,type Profile } from '@/features/profile/model';
import { useProfile } from '@/features/profile/ProfileProvider';
import { pickProfilePhoto } from '@/features/profile/photo-picker';
import { saveProfile } from '@/features/profile/service';
import { MenuGroup,MenuRow } from '@/features/settings/MenuUI';
import { config } from '@/lib/config';
import { useTheme } from '@/theme/ThemeProvider';
export default function ProfileScreen(){
  const state=useProfile();
  return <Screen><ScreenHeader title="Your profile" subtitle="Personal details and regional preferences" guideId="profile-page"/>{state?.profile?<ProfileEditor key={state.profile.id} profile={state.profile} refresh={state.refresh}/>:<Card><Text>{state?.error || 'Loading your profile…'}</Text>{state?.error?<Button label="Try again" onPress={()=>void state.refresh()}/>:null}</Card>}</Screen>;
}
export function ProfileEditor({profile,refresh}:{profile:Profile;refresh():Promise<void>}){
  const {colors}=useTheme();
  const [first,setFirst]=useState(profile.firstName || (profile.name.includes('@')?'':profile.name.split(' ')[0]));
  const [last,setLast]=useState(profile.lastName || (profile.firstName?'':profile.name.includes('@')?'':profile.name.split(' ').slice(1).join(' ')));
  const [avatar,setAvatar]=useState<AvatarValue>(profile.avatar);
  const [photo,setPhoto]=useState<{uri:string;base64:string}|null>(null),[picking,setPicking]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  const saving=useRef(false);
  const name=[first,last].filter(Boolean).join(' ') || profile.name;
  const changeAvatar=(value:AvatarValue)=>{setAvatar(value);setMessage(null);};
  async function choosePhoto(){
    setPicking(true);setMessage(null);
    try{const next=await pickProfilePhoto();if(next){setPhoto(next);setAvatar({...avatar,kind:'photo',path:null,sticker:null});}}
    catch{setMessage('Could not open that photo. Please choose another image.');}
    finally{setPicking(false);}
  }
  async function save(){
    if(saving.current)return;saving.current=true;setBusy(true);setMessage(null);
    try{const saved=await saveProfile(profile.id,first,last,avatar,avatar.kind==='photo'?photo?.base64 ?? null:null);await refresh();setAvatar(saved);setPhoto(null);setMessage('Profile saved. Your avatar is updated throughout OneLedger.');}
    catch(e){setMessage(e instanceof Error?e.message:'Could not save your profile. Try again.');}
    finally{saving.current=false;setBusy(false);}
  }
  return <>
    <Card style={{alignItems:'center',gap:8,paddingVertical:20}}>
      <Avatar name={name} size={88} avatar={avatar} photoUrl={photo?.uri ?? profile.photoUrl}/>
      <Text variant="title" style={{textAlign:'center'}}>{name}</Text>
      <Text variant="caption" color="textMuted">{profile.email}</Text>
    </Card>
    <Card style={{gap:14}}>
      <Text variant="heading">Make it yours</Text>
      <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{(['initials','sticker','photo'] as const).map(kind=><Chip key={kind} label={kind==='initials'?'Initials':kind==='sticker'?'Sticker':'Photo'} selected={avatar.kind===kind} onPress={()=>changeAvatar({...avatar,kind,sticker:kind==='sticker'?(avatar.sticker || 'sparkles'):null,path:kind==='photo'?profile.avatar.path:null})}/>)}</View>
      {avatar.kind==='sticker'?<View accessibilityLabel="Choose a sticker" style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{STICKERS.map(s=><Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${s.label} sticker`} accessibilityState={{selected:avatar.sticker===s.id}} onPress={()=>changeAvatar({...avatar,sticker:s.id})} style={{width:56,height:56,borderRadius:16,alignItems:'center',justifyContent:'center',backgroundColor:avatar.sticker===s.id?colors.accentBg:colors.background,borderWidth:avatar.sticker===s.id?2:0,borderColor:colors.accent}}><Text style={{fontSize:30,lineHeight:40,fontFamily:undefined}}>{s.glyph}</Text></Pressable>)}</View>:null}
      {avatar.kind==='photo'?<><Button label={photo || profile.avatar.path?'Choose another photo':'Choose a photo'} variant="secondary" fullWidth loading={picking} disabled={busy} onPress={()=>void choosePhoto()}/><Text variant="caption" color="textMuted">Choose and crop one image. It uploads privately when you save.</Text></>:<View style={{flexDirection:'row',gap:12,flexWrap:'wrap'}}>{Object.entries(AVATAR_COLORS).map(([key,color])=><Pressable key={key} accessibilityRole="button" accessibilityLabel={`${key} background`} accessibilityState={{selected:avatar.color===key}} onPress={()=>changeAvatar({...avatar,color:key as AvatarValue['color']})} style={{width:44,height:44,borderRadius:22,backgroundColor:color.bg,alignItems:'center',justifyContent:'center',borderColor:color.ink,borderWidth:avatar.color===key?2:0}}>{avatar.color===key?<Feather name="check" size={18} color={color.ink}/>:null}</Pressable>)}</View>}
      <Text variant="caption" color="textMuted">Your avatar appears on Home, More and Settings.</Text>
    </Card>
    <Card style={{gap:14}}><Text variant="heading">Personal details</Text>
      <TextField label="First name" value={first} onChangeText={v=>{setFirst(v);setMessage(null);}} maxLength={80} autoComplete="given-name"/>
      <TextField label="Last name" value={last} onChangeText={v=>{setLast(v);setMessage(null);}} maxLength={80} autoComplete="family-name"/>
      <Button label="Save profile" fullWidth loading={busy} disabled={picking} onPress={()=>void save()}/>
      {message?<Text variant="caption" accessibilityRole="alert" color={message.startsWith('Profile saved')?'moneyPositive':'attention'}>{message}</Text>:null}
    </Card>
    <MenuGroup title="Your account">
      <MenuRow label="Email" value={profile.email} icon="mail"/>
      <MenuRow label="Regional preferences" value={[profile.country,profile.currency].filter(Boolean).join(' · ')} icon="globe" external onPress={()=>void Linking.openURL(`${config.apiBaseUrl}/settings/profile`).catch(()=>setMessage('Could not open regional preferences.'))}/>
      <MenuRow label="App lock" icon="lock" onPress={()=>router.push('/security')}/>
      <MenuRow label="Settings" icon="settings" onPress={()=>router.push('/settings')}/>
    </MenuGroup>
  </>;
}
