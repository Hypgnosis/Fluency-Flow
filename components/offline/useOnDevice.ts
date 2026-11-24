import { useEffect, useState } from 'react';
import { onDeviceRuntime, type RuntimeStatus } from '../../services/onDevice/runtime';
import type { EngineKind } from '../../services/textEngine';

/** Live status of the on-device runtime (idle / loading / ready / error). */
export function useOnDeviceStatus(): RuntimeStatus {
    const [status, setStatus] = useState<RuntimeStatus>(onDeviceRuntime.status);
    useEffect(() => onDeviceRuntime.subscribe(setStatus), []);
    return status;
}

const ENGINE_KEY = 'glossos_text_engine';

/** The engine the learner picked for text features, remembered across visits. */
export function useEnginePreference(): [EngineKind, (kind: EngineKind) => void] {
    const [kind, setKind] = useState<EngineKind>(() => {
        try {
            return localStorage.getItem(ENGINE_KEY) === 'device' ? 'device' : 'cloud';
        } catch {
            return 'cloud';
        }
    });
    const update = (next: EngineKind) => {
        setKind(next);
        try { localStorage.setItem(ENGINE_KEY, next); } catch { /* storage unavailable */ }
    };
    return [kind, update];
}

/** Tracks the browser's online/offline state. */
export function useOnline(): boolean {
    const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);
    return online;
}
