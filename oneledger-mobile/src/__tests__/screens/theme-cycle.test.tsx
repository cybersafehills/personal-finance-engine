import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeCycleButton } from '@/features/settings/ThemeCycleButton';
import { ThemeProvider } from '@/theme/ThemeProvider';
const mockSave = jest.fn();
jest.mock('@/theme/preference', () => ({ ...jest.requireActual('@/theme/preference'), savePreference: (value: string) => mockSave(value) }));
it('cycles Automatic, Light, Dark and back, persisting every choice', async () => {
    await render(<ThemeProvider initialPreference="system"><ThemeCycleButton /></ThemeProvider>);
    await fireEvent.press(screen.getByRole('button', { name: 'Theme: Automatic. Switch to Light' }));
    expect(mockSave).toHaveBeenLastCalledWith('light');
    await fireEvent.press(screen.getByRole('button', { name: 'Theme: Light. Switch to Dark' }));
    expect(mockSave).toHaveBeenLastCalledWith('dark');
    await fireEvent.press(screen.getByRole('button', { name: 'Theme: Dark. Switch to Automatic' }));
    expect(mockSave).toHaveBeenLastCalledWith('system');
});
