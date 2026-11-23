import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { captureSquareFrame } from '../../utils/imageUtils';

export interface LensViewfinderHandle {
    /** Returns the current frame as a square JPEG data URL, or null if the camera is not ready. */
    capture: () => string | null;
}

interface LensViewfinderProps {
    /** When set, the frozen frame is shown instead of the live camera (and the camera is released). */
    frozenImage: string | null;
    overlay?: React.ReactNode;
}

/** Inline square camera view with an aiming reticle. */
export const LensViewfinder = forwardRef<LensViewfinderHandle, LensViewfinderProps>(({ frozenImage, overlay }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [facing, setFacing] = useState<'environment' | 'user'>('environment');
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setReady(false);
    }, []);

    useEffect(() => {
        if (frozenImage) {
            stopStream();
            return;
        }
        let cancelled = false;
        (async () => {
            if (!navigator.mediaDevices?.getUserMedia) {
                setError('Camera needs a secure connection (https or localhost).');
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                streamRef.current = stream;
                setError(null);
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => undefined);
                }
            } catch (err) {
                const name = (err as Error).name;
                setError(name === 'NotAllowedError'
                    ? 'Camera access was blocked. Allow it in your browser settings, or upload a photo instead.'
                    : 'No camera found. You can upload a photo instead.');
            }
        })();
        return () => {
            cancelled = true;
            stopStream();
        };
    }, [facing, frozenImage, stopStream]);

    useImperativeHandle(ref, () => ({
        capture: () => (videoRef.current && ready ? captureSquareFrame(videoRef.current) : null),
    }), [ready]);

    return (
        <div className="relative w-full aspect-square max-h-[42vh] sm:max-h-[48vh] mx-auto rounded-3xl overflow-hidden bg-black border border-white/[0.08] shadow-2xl">
            {frozenImage ? (
                <img src={frozenImage} alt="Captured frame" className="w-full h-full object-cover" />
            ) : (
                <video
                    ref={videoRef}
                    playsInline
                    muted
                    onLoadedData={() => setReady(true)}
                    className={`w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
                />
            )}

            {!frozenImage && !error && (
                <>
                    {/* Reticle */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="relative w-1/2 h-1/2">
                            {['top-0 left-0 border-t-2 border-l-2 rounded-tl-xl', 'top-0 right-0 border-t-2 border-r-2 rounded-tr-xl',
                                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl', 'bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl'].map(pos => (
                                <div key={pos} className={`absolute w-6 h-6 border-[#FFBF00]/80 ${pos}`} />
                            ))}
                        </div>
                    </div>
                    <button
                        onClick={() => setFacing(f => (f === 'environment' ? 'user' : 'environment'))}
                        className="absolute top-3 right-3 p-2 rounded-full bg-black/50 border border-white/10 text-slate-300 hover:text-white"
                        aria-label="Switch camera"
                        title="Switch camera"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </>
            )}

            {error && !frozenImage && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                    <p className="text-slate-400 text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{error}</p>
                </div>
            )}

            {overlay}
        </div>
    );
});

LensViewfinder.displayName = 'LensViewfinder';
