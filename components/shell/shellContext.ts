import { createContext, useContext } from 'react';
import type { AppMode } from './nav';

export interface ShellApi {
    navigate: (mode: AppMode) => void;
    openSettings: () => void;
    /** The Talk page reports when a live conversation is running (locks navigation and settings). */
    setVoiceActive: (active: boolean) => void;
}

export const ShellCtx = createContext<ShellApi>({ navigate: () => { }, openSettings: () => { }, setVoiceActive: () => { } });

/** Lets a page move to another page or open the shared settings sheet. */
export const useShell = () => useContext(ShellCtx);
