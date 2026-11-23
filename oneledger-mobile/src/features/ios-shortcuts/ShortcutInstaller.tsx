import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ds';
import { useTheme } from '@/theme/ThemeProvider';
import { EMPTY_INSTALL, loadShortcutInstall, saveShortcutInstall, type ShortcutInstallState } from './install-state';
export function ShortcutInstaller({ connectUrl, captureUrl, open, single = false }: {
    single?: boolean;
    connectUrl: string;
    captureUrl: string;
    open(url: string): Promise<boolean>;
}) {
    const { colors } = useTheme();
    const [state, setState] = useState<ShortcutInstallState>(EMPTY_INSTALL), [opening, setOpening] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
    const touched = useRef(false);
    const current = useRef(EMPTY_INSTALL);
    useEffect(() => { let active = true; void loadShortcutInstall().then(value => { if (active && !touched.current) {
        current.current = value;
        setState(value);
    } }); return () => { active = false; }; }, []);
    function update(key: 'connect' | 'capture', patch: Partial<ShortcutInstallState['connect']>) { touched.current = true; const next = { ...current.current, [key]: { ...current.current[key], ...patch } }; current.current = next; setState(next); void saveShortcutInstall(next); }
    async function add(key: 'connect' | 'capture', url: string) { if (opening)
        return; setOpening(key); setError(null); try {
        if (await open(url))
            update(key, { opened: true });
        else
            setError('Could not open the download. Check your connection and try again.');
    }
    finally {
        setOpening(null);
    } }
    return <View style={{ gap: 16 }}>{([{ key: 'connect', name: 'Connect to OneLedger', url: single ? '' : connectUrl, color: colors.accentSolid }, { key: 'capture', name: 'OneLedger Capture', url: single ? connectUrl : captureUrl, color: colors.moneyPositiveSolid }] as const).filter(s => s.url).map(s => <View key={s.key} style={{ gap: 6 }}><Text variant="label">{s.name}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Pressable accessibilityRole="button" accessibilityLabel={`${state[s.key].opened ? 'Add it again' : 'Add'} “${s.name}”`} accessibilityState={{ disabled: opening !== null, busy: opening === s.key }} disabled={opening !== null} onPress={() => void add(s.key, s.url)} style={({ pressed }) => ({ flex: 1, minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: s.color, opacity: pressed ? 0.85 : 1, alignItems: 'center', justifyContent: 'center' })}><Text variant="bodyStrong" style={{ color: colors.onSolid }}>{opening === s.key ? 'Opening…' : state[s.key].opened ? 'Add it again' : `Add “${s.name}”`}</Text></Pressable><Pressable accessibilityRole="checkbox" accessibilityLabel={`${s.name} added`} accessibilityState={{ checked: state[s.key].added }} onPress={() => update(s.key, { added: !state[s.key].added })} style={{ minHeight: 44, paddingHorizontal: 10, borderRadius: 22, backgroundColor: state[s.key].added ? colors.accentBg : colors.background, flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name={state[s.key].added ? 'check-circle' : 'circle'} size={15} color={colors.accent}/><Text variant="caption" color="accent">Added</Text></Pressable></View></View>)}{error ? <Text accessibilityRole="alert" variant="caption" color="attention">{error}</Text> : null}</View>;
}
