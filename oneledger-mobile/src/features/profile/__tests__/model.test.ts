import {DEFAULT_AVATAR,initials,parseAvatar,profilePatch} from '../model';
const id='00000000-0000-4000-8000-000000000000';
it('uses names for initials and handles old email-only accounts',()=>{
 expect(initials('Yves Niyoyo')).toBe('YN');expect(initials('n-yves@example.com')).toBe('NY');expect(initials('')).toBe('U');
});
it('accepts owned photos and curated stickers but never remote or cross-user paths',()=>{
 expect(parseAvatar({kind:'photo',color:'mint',path:`${id}/00000000-0000-4000-8000-000000000001.jpg`},id).kind).toBe('photo');
 expect(parseAvatar({kind:'photo',color:'mint',path:'https://example.com/tracker.jpg'},id).kind).toBe('initials');
 expect(parseAvatar({kind:'photo',color:'mint',path:'11111111-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001.jpg'},id).kind).toBe('initials');
 expect(parseAvatar({kind:'sticker',sticker:'leaf',color:'rose'},id)).toEqual({kind:'sticker',sticker:'leaf',color:'rose',path:null});
 expect(parseAvatar({kind:'sticker',sticker:'unknown',color:'__proto__'},id)).toEqual(DEFAULT_AVATAR);
});
it('updates only editable identity fields and validates names',()=>{
 expect(profilePatch(' Yves ',' Niyoyo ',DEFAULT_AVATAR,id)).toEqual({first_name:'Yves',last_name:'Niyoyo',display_name:'Yves Niyoyo',profile_avatar:DEFAULT_AVATAR});
 expect(()=>profilePatch('', 'Test',DEFAULT_AVATAR,id)).toThrow();
 expect(()=>profilePatch('A'.repeat(81),'',DEFAULT_AVATAR,id)).toThrow();
});
