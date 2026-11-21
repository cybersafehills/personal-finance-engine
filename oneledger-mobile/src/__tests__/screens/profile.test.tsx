import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {ProfileEditor} from '@/app/(app)/profile';
import {DEFAULT_AVATAR,type Profile} from '@/features/profile/model';
const mockSave=jest.fn(),mockPick=jest.fn(),mockRefresh=jest.fn();
jest.mock('expo-router',()=>jest.requireActual('@/test/router-mock'));
jest.mock('@/features/profile/service',()=>({saveProfile:(...a:unknown[])=>mockSave(...a)}));
jest.mock('@/features/profile/photo-picker',()=>({pickProfilePhoto:()=>mockPick()}));
const profile:Profile={id:'own-user',firstName:'Yves',lastName:'Niyoyo',name:'Yves Niyoyo',email:'test@example.com',country:'RW',currency:'RWF',timezone:'Africa/Kigali',locale:'en',avatar:DEFAULT_AVATAR,photoUrl:null};
beforeEach(()=>{jest.clearAllMocks();mockSave.mockResolvedValue(DEFAULT_AVATAR);mockRefresh.mockResolvedValue(undefined);});
it('previews a sticker and name locally, saving only on an explicit tap',async()=>{
 await render(<ProfileEditor profile={profile} refresh={mockRefresh}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Sticker'}));
 await fireEvent.press(screen.getByRole('button',{name:'Leaf sticker'}));
 await fireEvent.changeText(screen.getByLabelText('First name'),'Dolton');
 expect(mockSave).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'Save profile'}));
 await waitFor(()=>expect(mockSave).toHaveBeenCalledWith('own-user','Dolton','Niyoyo',{...DEFAULT_AVATAR,kind:'sticker',sticker:'leaf'},null));
 expect(mockRefresh).toHaveBeenCalled();expect(await screen.findByText(/Profile saved/)).toBeTruthy();
});
it('cancelled photo selection does not save and failed saves stay editable',async()=>{
 mockPick.mockResolvedValue(null);mockSave.mockRejectedValue(new Error('Could not save your profile. Please try again.'));
 await render(<ProfileEditor profile={profile} refresh={mockRefresh}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Photo'}));await fireEvent.press(screen.getByRole('button',{name:'Choose a photo'}));
 expect(mockSave).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'Save profile'}));
 expect(await screen.findByText('Could not save your profile. Please try again.')).toBeTruthy();
 expect(screen.getByLabelText('First name').props.value).toBe('Yves');
});
