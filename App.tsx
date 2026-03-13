import React, { useState } from 'react';
import Conversation from './components/Conversation';
import { AuthProvider, useAuth } from './components/AuthModal';
import { UserProfile } from './components/UserProfile';

const AppContent: React.FC = () => {
  const { user } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="relative min-h-screen w-full bg-[#030305] overflow-hidden text-slate-200 selection:bg-cyan-500/30">
      {/* Premium Ambient Background Blobs */}
      <div className="ambient-blob ambient-blob-1" />
      <div className="ambient-blob ambient-blob-2" />
      <div className="ambient-blob ambient-blob-3" />

      {/* Subtle noise texture overlay */}
      <div className="fixed inset-0 opacity-[0.015] pointer-events-none z-0"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'a\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23a)\'/%3E%3C/svg%3E")' }}
      />

      <div className="w-full h-[100dvh] flex flex-col relative z-10">
        {/* Premium Header */}
        <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 mb-2">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Logo with animated glow */}
            <div className="relative group cursor-pointer">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-2xl blur-md opacity-20 group-hover:opacity-40 transition-all duration-700 animate-gradient-shift"></div>
              <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#0a0a14] border border-white/10 flex items-center justify-center shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-cyan-400 relative z-10 drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-none">
                Fluency<span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Flow</span>
              </h1>
              <p className="text-[9px] sm:text-[10px] font-semibold text-slate-500 tracking-[0.25em] uppercase mt-0.5">AI Language Tutor</p>
            </div>
          </div>

          {/* User Profile Button */}
          {user && (
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-2.5 px-3 sm:px-4 py-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] hover:border-white/15 rounded-full transition-all duration-300 group"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-cyan-500/20 group-hover:shadow-cyan-500/30 transition-shadow">
                {user.isAnonymous ? 'G' : (user.displayName?.[0] || user.email?.[0] || 'U')}
              </div>
              <span className="text-sm font-medium text-slate-400 group-hover:text-slate-200 hidden sm:inline transition-colors">
                {user.isAnonymous ? 'Guest' : (user.displayName?.split(' ')[0] || 'Profile')}
              </span>
            </button>
          )}
        </header>

        {/* Main Workspace */}
        <main className="flex-grow min-h-0 flex flex-col relative">
          <Conversation />
        </main>

        {/* Footer */}
        <footer className="flex-shrink-0 text-center px-4 sm:px-6 py-3 sm:py-4">
          <p className="text-slate-600 text-[9px] sm:text-[10px] tracking-[0.2em] uppercase opacity-50 hover:opacity-80 transition-opacity duration-500">
            Powered by Gemini Live API & Nano Banana Pro
          </p>
        </footer>
      </div>

      {/* Profile Modal */}
      {showProfile && <UserProfile onClose={() => setShowProfile(false)} />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;