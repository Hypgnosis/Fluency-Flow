import React, { useState, useEffect, Suspense, lazy } from 'react';
import Conversation from './components/Conversation';
import { AuthProvider, useAuth, AuthModal } from './components/AuthModal';
import { UserProfile } from './components/UserProfile';

const OnboardingPage = lazy(() => import('./components/OnboardingPage'));

const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [savedLangs, setSavedLangs] = useState<{ native: string; learning: string } | null>(null);

  // Check onboarding status
  useEffect(() => {
    if (user && !user.isAnonymous) {
      const done = localStorage.getItem('glossos_onboarded');
      if (done === 'true') {
        setOnboarded(true);
        const native = localStorage.getItem('glossos_native_lang') || 'English';
        const learning = localStorage.getItem('glossos_learning_lang') || 'Spanish';
        setSavedLangs({ native, learning });
      }
    } else if (user && user.isAnonymous) {
      // Guest users skip onboarding
      setOnboarded(true);
    }
  }, [user]);

  // Loading spinner
  if (loading) {
    return (
      <div className="min-h-screen w-full bg-[#0A0A0B] flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#FFBF00]/20 border-t-[#FFBF00] animate-spin" style={{ animationDuration: '1.2s' }} />
          <p className="text-slate-500 text-xs uppercase tracking-[0.2em]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            Loading GLOSSOS...
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated — show full-screen registration/login
  if (!user) {
    return (
      <div className="relative min-h-screen w-full bg-[#0A0A0B] overflow-hidden text-[#F5F5F7]">
        {/* Ambient background */}
        <div className="ambient-blob ambient-blob-1" />
        <div className="ambient-blob ambient-blob-2" />
        <div className="ambient-blob ambient-blob-3" />

        {/* Noise overlay */}
        <div className="fixed inset-0 opacity-[0.012] pointer-events-none z-0"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'a\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23a)\'/%3E%3C/svg%3E")' }}
        />

        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4">
          {/* Auth Modal rendered inline, not as an overlay */}
          <AuthModal />
        </div>
      </div>
    );
  }

  // Authenticated but not onboarded — show onboarding
  if (!onboarded) {
    return (
      <Suspense fallback={
        <div className="min-h-screen w-full bg-[#0A0A0B] flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-[#FFBF00]/20 border-t-[#FFBF00] animate-spin" style={{ animationDuration: '1.2s' }} />
        </div>
      }>
        <OnboardingPage onComplete={(native, learning) => {
          setSavedLangs({ native, learning });
          setOnboarded(true);
        }} />
      </Suspense>
    );
  }

  // Fully authenticated + onboarded — show main app
  return (
    <div className="relative min-h-screen w-full bg-[#0A0A0B] overflow-hidden text-[#F5F5F7] selection:bg-[#00FF41]/20">
      {/* Clinical Ambient Background Blobs */}
      <div className="ambient-blob ambient-blob-1" />
      <div className="ambient-blob ambient-blob-2" />
      <div className="ambient-blob ambient-blob-3" />

      {/* Subtle noise texture overlay */}
      <div className="fixed inset-0 opacity-[0.012] pointer-events-none z-0"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'a\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23a)\'/%3E%3C/svg%3E")' }}
      />

      <div className="w-full h-[100dvh] flex flex-col relative z-10">
        {/* GLOSSOS Header */}
        <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 mb-2">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* The Monolith Logo */}
            <div className="relative group cursor-pointer">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-[#FFBF00] via-[#00FF41] to-[#FFBF00] rounded-2xl blur-md opacity-15 group-hover:opacity-30 transition-all duration-700 animate-gradient-shift"></div>
              <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#0A0A0B] border border-white/[0.06] flex items-center justify-center shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-[#FFBF00]/8 to-[#00FF41]/8 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <img src="/glossos-logo.png" alt="GLOSSOS" className="w-8 h-8 sm:w-9 sm:h-9 relative z-10 object-contain" />
              </div>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tighter leading-none" style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif" }}>
                GLOSS<span className="text-[#FFBF00]">OS</span>
              </h1>
              <p className="text-[9px] sm:text-[10px] font-semibold text-slate-500 tracking-[0.25em] uppercase mt-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Linguistic Mastery System</p>
            </div>
          </div>

          {/* User Profile Button */}
          {user && (
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-2.5 px-3 sm:px-4 py-2 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] hover:border-[#FFBF00]/20 rounded-full transition-all duration-300 group"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FFBF00] via-[#00FF41] to-[#FFBF00] flex items-center justify-center text-black font-bold text-xs shadow-lg shadow-[#FFBF00]/15 group-hover:shadow-[#FFBF00]/25 transition-shadow">
                {user.isAnonymous ? 'G' : (user.displayName?.[0] || user.email?.[0] || 'U')}
              </div>
              <span className="text-sm font-medium text-slate-400 group-hover:text-slate-200 hidden sm:inline transition-colors" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {user.isAnonymous ? 'Guest' : (user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'Profile')}
              </span>
            </button>
          )}
        </header>

        {/* Main Workspace */}
        <main className="flex-grow min-h-0 flex flex-col relative">
          <Conversation defaultNativeLanguage={savedLangs?.native} defaultLearningLanguage={savedLangs?.learning} />
        </main>

        {/* Footer */}
        <footer className="flex-shrink-0 text-center px-4 sm:px-6 py-3 sm:py-4">
          <p className="text-slate-600 text-[9px] sm:text-[10px] tracking-[0.2em] uppercase opacity-40 hover:opacity-70 transition-opacity duration-500" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            Powered by Gemini Live API &amp; Neural Architecture
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