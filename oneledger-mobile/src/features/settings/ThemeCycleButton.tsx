import Feather from '@expo/vector-icons/Feather';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ds';
import { useTheme } from '@/theme/ThemeProvider';
const choices = ['system', 'light', 'dark'] as const;
const labels = { system: 'Automatic', light: 'Light', dark: 'Dark' };
export function ThemeCycleButton() {
    const { preference, setPreference, colors } = useTheme();
    const next = choices[(choices.indexOf(preference) + 1) % choices.length];
    return <Pressable accessibilityRole="button" accessibilityLabel={`Theme: ${labels[preference]}. Switch to ${labels[next]}`} accessibilityHint="Cycles Automatic, Light and Dark. Saves on this device." onPress={() => setPreference(next)} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, borderRadius: 22, backgroundColor: pressed ? colors.accentBg : colors.surface, flexDirection: 'row', gap: 6, alignItems: 'center' })}><Feather name={preference === 'system' ? 'monitor' : preference === 'dark' ? 'moon' : 'sun'} size={19} color={colors.accent}/><View><Text variant="caption" color="accent">{preference === 'system' ? 'Auto' : labels[preference]}</Text></View></Pressable>;
}
