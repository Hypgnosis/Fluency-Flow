import type { IconName } from '../ui/Icon';

export type AppMode = 'voice' | 'lens' | 'chat' | 'lab' | 'scribe' | 'offline';

export interface NavItem {
    id: AppMode;
    /** Short label for tabs and the sidebar. */
    label: string;
    icon: IconName;
    /** Page heading. */
    title: string;
    subtitle: string;
}

export const NAV: NavItem[] = [
    { id: 'voice', label: 'Talk', icon: 'mic', title: 'Talk', subtitle: 'A real conversation with your tutor, out loud' },
    { id: 'lens', label: 'Lens', icon: 'camera', title: 'Lens', subtitle: 'Point your camera at anything and learn its name' },
    { id: 'chat', label: 'Chat', icon: 'chat', title: 'Chat', subtitle: 'Practice by text, online or fully on-device' },
    { id: 'lab', label: 'Write', icon: 'pen', title: 'Writing Lab', subtitle: 'Correct, rewrite, translate and explain your text' },
    { id: 'scribe', label: 'Scribe', icon: 'wave', title: 'Audio Scribe', subtitle: 'Transcribe and translate songs, voice notes and clips' },
    { id: 'offline', label: 'Offline', icon: 'chip', title: 'Offline mode', subtitle: 'Run a private model on this device, no internet needed' },
];

/** The modes shown in the phone tab bar (Offline lives in the top bar there). */
export const PRIMARY_NAV = NAV.filter(n => n.id !== 'offline');

export const navItem = (id: AppMode) => NAV.find(n => n.id === id)!;

export const isAppMode = (v: unknown): v is AppMode => NAV.some(n => n.id === v);
