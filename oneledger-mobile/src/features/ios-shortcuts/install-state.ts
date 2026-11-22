import { deviceStore } from '@/lib/device-store';
export const SHORTCUT_RELEASE = '3.0.0';
export type ShortcutInstallState = {
    connect: {
        opened: boolean;
        added: boolean;
    };
    capture: {
        opened: boolean;
        added: boolean;
    };
};
export const EMPTY_INSTALL: ShortcutInstallState = { connect: { opened: false, added: false }, capture: { opened: false, added: false } };
const KEY = `oneledger.shortcuts.install.${SHORTCUT_RELEASE}`;
export async function loadShortcutInstall(): Promise<ShortcutInstallState> {
    try {
        const raw = await deviceStore.get(KEY);
        const v = raw ? JSON.parse(raw) : null;
        return { connect: { opened: v?.connect?.opened === true, added: v?.connect?.added === true }, capture: { opened: v?.capture?.opened === true, added: v?.capture?.added === true } };
    }
    catch {
        return EMPTY_INSTALL;
    }
}
export async function saveShortcutInstall(value: ShortcutInstallState) { try {
    await deviceStore.set(KEY, JSON.stringify(value));
}
catch { /* Installation still works if local preferences cannot be saved. */ } }
