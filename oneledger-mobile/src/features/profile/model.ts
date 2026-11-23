import { AVATAR_COLORS } from "@/theme/tokens";
export { AVATAR_COLORS } from "@/theme/tokens";
export const STICKERS = [
  { id: 'sparkles', glyph: '✨', label: 'Sparkles' }, { id: 'sun', glyph: '☀️', label: 'Sun' },
  { id: 'leaf', glyph: '🌿', label: 'Leaf' }, { id: 'mountain', glyph: '🏔️', label: 'Mountain' },
  { id: 'rocket', glyph: '🚀', label: 'Rocket' }, { id: 'coffee', glyph: '☕', label: 'Coffee' },
  { id: 'cat', glyph: '🐱', label: 'Cat' }, { id: 'wave', glyph: '🌊', label: 'Wave' },
] as const;
export type Avatar = { kind: 'initials' | 'sticker' | 'photo'; color: keyof typeof AVATAR_COLORS; sticker: string | null; path: string | null };
export const DEFAULT_AVATAR: Avatar = { kind: 'initials', color: 'indigo', sticker: null, path: null };
export type Profile = { id: string; firstName: string; lastName: string; name: string; email: string; country: string; currency: string; timezone: string; locale: string; avatar: Avatar; photoUrl: string | null };
export function initials(name: string) {
  const cleaned = name.includes('@') ? name.split('@')[0].replace(/[._-]+/g, ' ') : name;
  return cleaned.trim().split(/\s+/).filter(Boolean).slice(0,2).map(s => Array.from(s)[0]).join('').toLocaleUpperCase() || 'U';
}
export function parseAvatar(raw: unknown, userId: string): Avatar {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AVATAR };
  const r = raw as Record<string,unknown>;
  const color = typeof r.color === 'string' && Object.hasOwn(AVATAR_COLORS,r.color) ? r.color as Avatar['color'] : 'indigo';
  if (r.kind === 'sticker' && STICKERS.some(s => s.id === r.sticker)) return { kind:'sticker',color,sticker:r.sticker as string,path:null };
  if (r.kind === 'photo' && typeof r.path === 'string' && r.path.startsWith(`${userId}/`) && /^[\da-f-]{36}\/[-\da-f]{36}\.jpg$/.test(r.path)) return { kind:'photo',color,sticker:null,path:r.path };
  return { ...DEFAULT_AVATAR,color };
}
export function profilePatch(first: string, last: string, avatar: Avatar, userId: string) {
  const firstName=first.trim(),lastName=last.trim();
  if (!firstName || firstName.length>80 || lastName.length>80 || /[\u0000-\u001f\u007f]/.test(firstName+lastName)) throw new Error('Enter your first name and keep each name under 80 characters.');
  return { first_name:firstName,last_name:lastName || null,display_name:[firstName,lastName].filter(Boolean).join(' '),profile_avatar:parseAvatar(avatar,userId) };
}
