import React, { useState } from 'react';

interface SceneImageProps {
    imageDataUrl: string;
    description: string;
    isLoading?: boolean;
}

/**
 * Displays a generated scene image inline with the conversation.
 * Features a premium glass-morphism card with loading shimmer.
 */
export const SceneImage: React.FC<SceneImageProps> = ({
    imageDataUrl,
    description,
    isLoading = false,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);

    if (isLoading) {
        return <SceneImageSkeleton />;
    }

    return (
        <div className="w-full max-w-md mx-auto my-3 animate-fade-in">
            <div className="relative group rounded-2xl overflow-hidden bg-[#12141c] border border-white/10 shadow-2xl shadow-purple-900/10 transition-all duration-500 hover:border-purple-500/30 hover:shadow-purple-500/20">
                {/* Nano Banana Pro Badge */}
                <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10">
                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 animate-pulse" />
                    <span className="text-[9px] font-bold tracking-widest uppercase text-yellow-300/90">
                        Nano Banana Pro
                    </span>
                </div>

                {/* Image Container */}
                <div
                    className={`relative overflow-hidden cursor-pointer transition-all duration-500 ${isExpanded ? 'max-h-[600px]' : 'max-h-[300px]'
                        }`}
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    {/* Loading shimmer overlay */}
                    {!hasLoaded && (
                        <div className="absolute inset-0 z-10">
                            <SceneImageSkeleton />
                        </div>
                    )}

                    <img
                        src={imageDataUrl}
                        alt={description}
                        onLoad={() => setHasLoaded(true)}
                        className={`w-full h-auto object-cover transition-all duration-700 ${hasLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
                            } ${isExpanded ? '' : 'object-top'}`}
                    />

                    {/* Gradient overlay on bottom */}
                    {!isExpanded && (
                        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#12141c] to-transparent pointer-events-none" />
                    )}

                    {/* Expand indicator */}
                    <div className="absolute bottom-2 right-3 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-1 px-2 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10">
                            <svg
                                className={`w-3 h-3 text-white transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="text-[9px] text-white/70 font-medium">
                                {isExpanded ? 'Collapse' : 'Expand'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Caption Footer */}
                <div className="px-4 py-3 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                            Visual scene generated to help you understand the situation
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Skeleton loader for the scene image while it's being generated.
 */
export const SceneImageSkeleton: React.FC = () => {
    return (
        <div className="w-full max-w-md mx-auto my-3">
            <div className="relative rounded-2xl overflow-hidden bg-[#12141c] border border-white/10">
                {/* Generating badge */}
                <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-purple-500/30">
                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 to-cyan-400 animate-spin" style={{
                        borderRadius: '50%',
                        border: '1px solid transparent',
                        borderTopColor: '#a78bfa',
                    }} />
                    <span className="text-[9px] font-bold tracking-widest uppercase text-purple-300/90">
                        Generating Scene...
                    </span>
                </div>

                {/* Shimmer skeleton */}
                <div className="w-full h-[200px] relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-[#12141c] via-[#1e2030] to-[#12141c] animate-shimmer" />

                    {/* Floating particles */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative">
                            {/* Center icon */}
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center animate-pulse">
                                <svg className="w-8 h-8 text-purple-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>

                            {/* Orbiting dots */}
                            <div className="absolute -inset-6 animate-spin" style={{ animationDuration: '3s' }}>
                                <div className="absolute top-0 left-1/2 w-1.5 h-1.5 bg-purple-400/40 rounded-full" />
                            </div>
                            <div className="absolute -inset-8 animate-spin" style={{ animationDuration: '5s', animationDirection: 'reverse' }}>
                                <div className="absolute top-0 left-1/2 w-1 h-1 bg-cyan-400/30 rounded-full" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer skeleton */}
                <div className="px-4 py-3 bg-gradient-to-r from-purple-900/10 to-blue-900/10 border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded bg-purple-500/20 animate-pulse" />
                        <div className="flex-1 space-y-1">
                            <div className="h-2 bg-white/5 rounded-full w-3/4 animate-pulse" />
                            <div className="h-2 bg-white/5 rounded-full w-1/2 animate-pulse" style={{ animationDelay: '0.2s' }} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SceneImage;
