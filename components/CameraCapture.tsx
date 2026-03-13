import React, { useState, useRef, useEffect } from 'react';
import { CameraState } from '../types';

interface CameraCaptureProps {
    onCapture: (imageDataUrl: string) => void;
    onClose: () => void;
    isActive: boolean;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose, isActive }) => {
    const [cameraState, setCameraState] = useState<CameraState>({
        isActive: false,
        hasPermission: false,
        error: null,
        facingMode: 'environment'
    });
    const [captureFlash, setCaptureFlash] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (isActive) {
            startCamera();
        } else {
            stopCamera();
        }

        return () => {
            stopCamera();
        };
    }, [isActive, cameraState.facingMode]);

    const startCamera = async () => {
        try {
            const constraints = {
                video: {
                    facingMode: cameraState.facingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }

            setCameraState(prev => ({
                ...prev,
                isActive: true,
                hasPermission: true,
                error: null
            }));
        } catch (err) {
            console.error('Camera access error:', err);
            const errorMessage = err instanceof Error
                ? err.message.includes('Permission denied')
                    ? 'Camera permission denied. Please allow camera access in your browser settings.'
                    : err.message
                : 'Failed to access camera';

            setCameraState(prev => ({
                ...prev,
                isActive: false,
                hasPermission: false,
                error: errorMessage
            }));
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        setCameraState(prev => ({
            ...prev,
            isActive: false
        }));
    };

    const captureFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) return;

        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw current video frame to canvas
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Get image data as base64
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);

        // Flash effect
        setCaptureFlash(true);
        setTimeout(() => setCaptureFlash(false), 200);

        // Callback with captured image
        onCapture(imageDataUrl);
    };

    const toggleCamera = () => {
        setCameraState(prev => ({
            ...prev,
            facingMode: prev.facingMode === 'user' ? 'environment' : 'user'
        }));
    };

    if (!isActive) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Camera Flash Effect */}
            {captureFlash && (
                <div className="absolute inset-0 bg-white pointer-events-none animate-flash z-50" />
            )}

            {/* Video Stream */}
            <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
                {cameraState.error ? (
                    <div className="text-center p-8">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-rose-500/20 flex items-center justify-center">
                            <svg className="w-10 h-10 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h3 className="text-white font-semibold text-lg mb-2">Camera Error</h3>
                        <p className="text-slate-400 text-sm max-w-md">{cameraState.error}</p>
                        <button
                            onClick={onClose}
                            className="mt-6 px-6 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full transition-colors"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <>
                        <video
                            ref={videoRef}
                            className="max-w-full max-h-full object-contain"
                            playsInline
                            muted
                        />

                        {/* Target Reticle */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="relative w-64 h-64 border-2 border-cyan-400/50 rounded-2xl">
                                {/* Corner accents */}
                                <div className="absolute top-0 left-0 w-8 h-8 border-l-4 border-t-4 border-cyan-400 rounded-tl-2xl" />
                                <div className="absolute top-0 right-0 w-8 h-8 border-r-4 border-t-4 border-cyan-400 rounded-tr-2xl" />
                                <div className="absolute bottom-0 left-0 w-8 h-8 border-l-4 border-b-4 border-cyan-400 rounded-bl-2xl" />
                                <div className="absolute bottom-0 right-0 w-8 h-8 border-r-4 border-b-4 border-cyan-400 rounded-br-2xl" />

                                {/* Center dot */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                            </div>
                        </div>

                        {/* Instruction Text */}
                        <div className="absolute top-8 left-0 right-0 flex justify-center">
                            <div className="px-6 py-3 bg-black/60 backdrop-blur-md rounded-full border border-white/20">
                                <p className="text-white text-sm font-medium">Point at an object and tap capture</p>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Control Bar */}
            {!cameraState.error && (
                <div className="flex-shrink-0 p-6 bg-black/80 backdrop-blur-md border-t border-white/10">
                    <div className="flex items-center justify-between max-w-2xl mx-auto">
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="p-4 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                            aria-label="Close camera"
                        >
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        {/* Capture Button */}
                        <button
                            onClick={captureFrame}
                            className="relative w-20 h-20 rounded-full bg-white/20 border-4 border-white flex items-center justify-center hover:bg-white/30 transition-all active:scale-95"
                            aria-label="Capture photo"
                        >
                            <div className="w-16 h-16 rounded-full bg-white" />
                        </button>

                        {/* Flip Camera Button */}
                        <button
                            onClick={toggleCamera}
                            className="p-4 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                            aria-label="Flip camera"
                        >
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
