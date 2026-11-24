import React from 'react';
import type { EngineKind } from '../../services/textEngine';
import { findModel } from '../../services/onDevice/models';
import { useOnDeviceStatus, useOnline } from './useOnDevice';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

interface EngineSwitchProps {
    value: EngineKind;
    onChange: (kind: EngineKind) => void;
    onManageModels: () => void;
}

/** Chooses where text features run: Gemini in the cloud or a model on this device. */
export const EngineSwitch: React.FC<EngineSwitchProps> = ({ value, onChange, onManageModels }) => {
    const status = useOnDeviceStatus();
    const online = useOnline();
    const loadedName = status.state === 'ready' ? findModel(status.modelId)?.name : null;

    const option = (kind: EngineKind, label: string, hint: string) => (
        <button
            onClick={() => onChange(kind)}
            className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${value === kind
                ? 'bg-[#00FF41]/15 text-[#00FF41] border border-[#00FF41]/30'
                : 'text-slate-500 border border-transparent hover:text-slate-300'}`}
            title={hint}
            style={MONO}
        >
            {label}
        </button>
    );

    return (
        <div className="flex items-center gap-2 flex-wrap text-[11px]" style={MONO}>
            <div className="flex items-center gap-1 rounded-full bg-black/30 border border-white/[0.06] p-0.5">
                {option('cloud', 'Cloud', 'Gemini: best quality, needs internet')}
                {option('device', 'On-device', 'Gemma on this device: private and works offline')}
            </div>
            {value === 'device' && (
                <button onClick={onManageModels} className={status.state === 'ready' ? 'text-slate-500 hover:text-slate-300' : 'text-[#FFBF00] hover:underline'}>
                    {status.state === 'ready' ? `${loadedName} ✓` : status.state === 'loading' ? 'Loading model…' : 'Choose a model →'}
                </button>
            )}
            {value === 'cloud' && !online && (
                <button onClick={() => onChange('device')} className="text-amber-300 hover:underline">You're offline: switch to On-device</button>
            )}
        </div>
    );
};
