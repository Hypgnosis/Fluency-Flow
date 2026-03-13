import React, { useState, useRef, useEffect } from 'react';

interface AudioComparisonPlayerProps {
    userAudioUrl: string;
    nativeAudioUrl?: string;
    word?: string;
}

export const AudioComparisonPlayer: React.FC<AudioComparisonPlayerProps> = ({
    userAudioUrl,
    nativeAudioUrl,
    word
}) => {
    const [playing, setPlaying] = useState<'none' | 'user' | 'native'>('none');
    const [userProgress, setUserProgress] = useState(0);
    const [nativeProgress, setNativeProgress] = useState(0);

    const userAudioRef = useRef<HTMLAudioElement>(null);
    const nativeAudioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        const userAudio = userAudioRef.current;
        const nativeAudio = nativeAudioRef.current;

        if (!userAudio) return;

        const handleUserTimeUpdate = () => {
            const progress = (userAudio.currentTime / userAudio.duration) * 100;
            setUserProgress(progress);
        };

        const handleUserEnded = () => {
            setPlaying('none');
            setUserProgress(0);
        };

        const handleNativeTimeUpdate = () => {
            if (nativeAudio) {
                const progress = (nativeAudio.currentTime / nativeAudio.duration) * 100;
                setNativeProgress(progress);
            }
        };

        const handleNativeEnded = () => {
            setPlaying('none');
            setNativeProgress(0);
        };

        userAudio.addEventListener('timeupdate', handleUserTimeUpdate);
        userAudio.addEventListener('ended', handleUserEnded);

        if (nativeAudio) {
            nativeAudio.addEventListener('timeupdate', handleNativeTimeUpdate);
            nativeAudio.addEventListener('ended', handleNativeEnded);
        }

        return () => {
            userAudio.removeEventListener('timeupdate', handleUserTimeUpdate);
            userAudio.removeEventListener('ended', handleUserEnded);
            if (nativeAudio) {
                nativeAudio.removeEventListener('timeupdate', handleNativeTimeUpdate);
                nativeAudio.removeEventListener('ended', handleNativeEnded);
            }
        };
    }, []);

    const playUser = () => {
        const audio = userAudioRef.current;
        if (!audio) return;

        if (playing === 'native') {
            nativeAudioRef.current?.pause();
        }

        if (playing === 'user') {
            audio.pause();
            audio.currentTime = 0;
            setPlaying('none');
            setUserProgress(0);
        } else {
            audio.currentTime = 0;
            audio.play();
            setPlaying('user');
        }
    };

    const playNative = () => {
        const audio = nativeAudioRef.current;
        if (!audio) return;

        if (playing === 'user') {
            userAudioRef.current?.pause();
        }

        if (playing === 'native') {
            audio.pause();
            audio.currentTime = 0;
            setPlaying('none');
            setNativeProgress(0);
        } else {
            audio.currentTime = 0;
            audio.play();
            setPlaying('native');
        }
    };

    const playBoth = async () => {
        if (playing !== 'none') {
            userAudioRef.current?.pause();
            nativeAudioRef.current?.pause();
            setPlaying('none');
            return;
        }

        // Play user first, then native
        const userAudio = userAudioRef.current;
        const nativeAudio = nativeAudioRef.current;

        if (userAudio) {
            userAudio.currentTime = 0;
            setPlaying('user');
            await userAudio.play();

            userAudio.onended = () => {
                if (nativeAudio) {
                    nativeAudio.currentTime = 0;
                    setPlaying('native');
                    nativeAudio.play();
                } else {
                    setPlaying('none');
                }
            };
        }
    };

    return (
        <div className="p-6 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h4 className="text-white font-semibold text-lg flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        Audio Comparison
                    </h4>
                    {word && <p className="text-slate-400 text-sm mt-1">Comparing: "{word}"</p>}
                </div>
            </div>

            {/* Audio elements (hidden) */}
            <audio ref={userAudioRef} src={userAudioUrl} preload="auto" />
            {nativeAudioUrl && <audio ref={nativeAudioRef} src={nativeAudioUrl} preload="auto" />}

            {/* User Audio Card */}
            <div className={`p-4 rounded-xl border transition-all ${playing === 'user'
                    ? 'bg-cyan-500/20 border-cyan-500/50 shadow-lg shadow-cyan-500/20'
                    : 'bg-white/5 border-white/10'
                }`}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-white font-medium text-sm">Your Pronunciation</p>
                            <p className="text-slate-500 text-xs">Click to play</p>
                        </div>
                    </div>

                    <button
                        onClick={playUser}
                        className={`p-3 rounded-full transition-all ${playing === 'user'
                                ? 'bg-cyan-500 text-white shadow-lg'
                                : 'bg-white/10 text-white hover:bg-white/20'
                            }`}
                    >
                        {playing === 'user' ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        )}
                    </button>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1 bg-black/30 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-100"
                        style={{ width: `${userProgress}%` }}
                    />
                </div>
            </div>

            {/* Native Audio Card */}
            {nativeAudioUrl && (
                <div className={`p-4 rounded-xl border transition-all ${playing === 'native'
                        ? 'bg-emerald-500/20 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
                        : 'bg-white/5 border-white/10'
                    }`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-white font-medium text-sm">Native Speaker</p>
                                <p className="text-slate-500 text-xs">Reference audio</p>
                            </div>
                        </div>

                        <button
                            onClick={playNative}
                            className={`p-3 rounded-full transition-all ${playing === 'native'
                                    ? 'bg-emerald-500 text-white shadow-lg'
                                    : 'bg-white/10 text-white hover:bg-white/20'
                                }`}
                        >
                            {playing === 'native' ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1 bg-black/30 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all duration-100"
                            style={{ width: `${nativeProgress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Compare Button */}
            {nativeAudioUrl && (
                <button
                    onClick={playBoth}
                    className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {playing !== 'none' ? 'Stop Comparison' : 'Compare Both (You → Native)'}
                </button>
            )}

            {/* Help Text */}
            <p className="text-slate-500 text-xs text-center">
                Listen to both recordings to identify differences in pronunciation
            </p>
        </div>
    );
};
