import { decodePhoto,saveProfile,getProfile } from '../service';
import { DEFAULT_AVATAR } from '../model';
const id='00000000-0000-4000-8000-000000000000';
const mockUpload=jest.fn(),mockRemove=jest.fn(),mockSigned=jest.fn(),mockSingle=jest.fn(),mockUpdate=jest.fn();
jest.mock('expo-crypto',()=>({randomUUID:()=> '00000000-0000-4000-8000-000000000001'}));
jest.mock('@/api/supabase',()=>({supabase:{from:()=>({select:()=>({eq:()=>({single:()=>mockSingle()})}),update:(p:unknown)=>{mockUpdate(p);return {eq:()=>({select:()=>({single:()=>mockSingle()})})};}}),storage:{from:()=>({upload:(...a:unknown[])=>mockUpload(...a),remove:(...a:unknown[])=>mockRemove(...a),createSignedUrl:(...a:unknown[])=>mockSigned(...a)})}}}));
beforeEach(()=>{jest.clearAllMocks();mockUpload.mockResolvedValue({error:null});mockRemove.mockResolvedValue({error:null});mockSigned.mockResolvedValue({data:{signedUrl:'https://signed.test/own'}});});
it('does not upload or change a profile for invalid input',async()=>{
 await expect(saveProfile(id,'','',DEFAULT_AVATAR,null)).rejects.toThrow();expect(mockUpload).not.toHaveBeenCalled();expect(mockUpdate).not.toHaveBeenCalled();
 expect(()=>decodePhoto('not a jpeg')).toThrow();
});
it('uploads a private JPEG then saves only its owned path, removing the upload if the profile write fails',async()=>{
 mockSingle.mockResolvedValueOnce({data:{profile_avatar:DEFAULT_AVATAR}}).mockResolvedValueOnce({data:null,error:{message:'offline'}});
 await expect(saveProfile(id,'Yves','Niyoyo',{...DEFAULT_AVATAR,kind:'photo'},'/9j/2Q==')).rejects.toThrow('Could not save');
 const path=`${id}/00000000-0000-4000-8000-000000000001.jpg`;
 expect(mockUpload).toHaveBeenCalledWith(path,expect.any(ArrayBuffer),{contentType:'image/jpeg',upsert:false});
 expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({profile_avatar:{kind:'photo',color:'indigo',sticker:null,path}}));expect(mockRemove).toHaveBeenCalledWith([path]);
});
it('replaces an avatar only after the profile write succeeds and retires the previous photo',async()=>{
 const path=`${id}/00000000-0000-4000-8000-000000000002.jpg`;
 mockSingle.mockResolvedValueOnce({data:{profile_avatar:{...DEFAULT_AVATAR,kind:'photo',path}}}).mockResolvedValueOnce({data:{id},error:null});
 const avatar={...DEFAULT_AVATAR,kind:'sticker' as const,sticker:'leaf'};
 await expect(saveProfile(id,'Yves','',avatar,null)).resolves.toEqual(avatar);
 expect(mockRemove).toHaveBeenCalledWith([path]);expect(mockUpload).not.toHaveBeenCalled();
});
it('loads names and uses signed URLs for photo display',async()=>{
 const path=`${id}/00000000-0000-4000-8000-000000000001.jpg`;
 mockSingle.mockResolvedValue({data:{display_name:'Yves Niyoyo',first_name:'Yves',last_name:'Niyoyo',profile_avatar:{...DEFAULT_AVATAR,kind:'photo',path}},error:null});
 const p=await getProfile(id,'test@example.com');expect(p.name).toBe('Yves Niyoyo');expect(p.photoUrl).toBe('https://signed.test/own');expect(mockSigned).toHaveBeenCalledWith(path,3600);
});
