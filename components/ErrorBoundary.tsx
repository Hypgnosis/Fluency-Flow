import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[GLOSSOS] Uncaught render error:', error, errorInfo);
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center p-6">
                    <div className="max-w-md w-full text-center space-y-6">
                        {/* Icon */}
                        <div className="w-20 h-20 mx-auto rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                            <svg className="w-10 h-10 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        </div>

                        {/* Title */}
                        <div>
                            <h1 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                Something Went Wrong
                            </h1>
                            <p className="text-slate-400 text-sm leading-relaxed">
                                GLOSSOS encountered an unexpected error. This has been logged for diagnostics.
                            </p>
                        </div>

                        {/* Error Details (collapsed by default) */}
                        {this.state.error && (
                            <details className="text-left bg-black/30 border border-white/[0.06] rounded-xl p-4">
                                <summary className="text-slate-500 text-xs cursor-pointer hover:text-slate-300 transition-colors uppercase tracking-wider font-semibold">
                                    Technical Details
                                </summary>
                                <pre className="mt-3 text-rose-300/80 text-xs font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                    {this.state.error.message}
                                </pre>
                            </details>
                        )}

                        {/* Reload Button */}
                        <button
                            onClick={this.handleReload}
                            className="px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl hover:shadow-cyan-500/20"
                        >
                            Reload Application
                        </button>

                        {/* Branding */}
                        <p className="text-slate-600 text-xs tracking-widest uppercase" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                            GLOSSOS v1.0
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
