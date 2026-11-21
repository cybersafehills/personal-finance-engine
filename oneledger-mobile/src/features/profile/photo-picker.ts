import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator,SaveFormat } from 'expo-image-manipulator';
export async function pickProfilePhoto():Promise<{uri:string;base64:string}|null>{
  const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:1,exif:false});
  if(picked.canceled)return null;
  const asset=picked.assets[0];
  const image=ImageManipulator.manipulate(asset.uri);
  image.resize(asset.width>=asset.height?{width:512}:{height:512});
  const rendered=await image.renderAsync();
  const saved=await rendered.saveAsync({format:SaveFormat.JPEG,compress:0.8,base64:true});
  if(!saved.base64)throw new Error('Could not read the selected photo.');
  return {uri:saved.uri,base64:saved.base64};
}
