import React, { useState, Suspense, lazy } from 'react';

const LanguageOrb = lazy(() => import('./LanguageOrb'));

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Japanese', 'Portuguese', 'Korean', 'Chinese', 'Russian', 'Slovak', 'Yucatec Mayan'];

const LANGUAGE_FLAGS: Record<string, string> = {
  'English': '🇺🇸', 'Spanish': '🇪🇸', 'French': '🇫🇷', 'German': '🇩🇪', 'Italian': '🇮🇹',
  'Japanese': '🇯🇵', 'Portuguese': '🇧🇷', 'Korean': '🇰🇷', 'Chinese': '🇨🇳', 'Russian': '🇷🇺',
  'Slovak': '🇸🇰', 'Yucatec Mayan': '🌿',
};

interface OnboardingPageProps {
  onComplete: (nativeLanguage: string, learningLanguage: string) => void;
}

export default function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState(0);
  const [nativeLanguage, setNativeLanguage] = useState('English');
  const [learningLanguage, setLearningLanguage] = useState('Spanish');

  const handleComplete = () => {
    localStorage.setItem('glossos_onboarded', 'true');
    localStorage.setItem('glossos_native_lang', nativeLanguage);
    localStorage.setItem('glossos_learning_lang', learningLanguage);
    onComplete(nativeLanguage, learningLanguage);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0B] flex flex-col items-center justify-center overflow-y-auto">
      {/* Ambient blobs */}
      <div className="ambient-blob ambient-blob-1" />
      <div className="ambient-blob ambient-blob-2" />

      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-8 flex flex-col items-center">

        {/* Step 0: Welcome + Language Selection */}
        {step === 0 && (
          <div className="animate-fade-in w-full text-center">
            {/* Logo */}
            <div className="mb-6">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tighter" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
                GLOSS<span className="text-[#FFBF00]">OS</span>
              </h1>
              <p className="text-[10px] text-slate-500 tracking-[0.25em] uppercase mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                Linguistic Mastery System
              </p>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
              Configure Your Neural Profile
            </h2>
            <p className="text-slate-400 text-sm mb-8" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              Select your languages to initialize the acquisition engine
            </p>

            {/* Language selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 text-left">
              {/* Native Language */}
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-[#00FF41] font-bold mb-3" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  I Speak
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang}
                      onClick={() => setNativeLanguage(lang)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                        nativeLanguage === lang
                          ? 'bg-[#00FF41]/10 border-[#00FF41]/30 text-[#00FF41] shadow-lg shadow-[#00FF41]/5'
                          : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                      }`}
                    >
                      <span className="text-base">{LANGUAGE_FLAGS[lang]}</span>
                      <span className="truncate">{lang}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Learning Language */}
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-[#FFBF00] font-bold mb-3" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  I Want to Learn
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGES.filter(l => l !== nativeLanguage).map(lang => (
                    <button
                      key={lang}
                      onClick={() => setLearningLanguage(lang)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                        learningLanguage === lang
                          ? 'bg-[#FFBF00]/10 border-[#FFBF00]/30 text-[#FFBF00] shadow-lg shadow-[#FFBF00]/5'
                          : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                      }`}
                    >
                      <span className="text-base">{LANGUAGE_FLAGS[lang]}</span>
                      <span className="truncate">{lang}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep(1)}
              className="px-8 py-3.5 bg-gradient-to-r from-[#FFBF00] to-[#00FF41] hover:from-[#FFBF00]/90 hover:to-[#00FF41]/90 text-black font-bold rounded-xl transition-all uppercase tracking-wider text-sm shadow-lg shadow-[#FFBF00]/20"
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 1: 3D Orb + Instructions */}
        {step === 1 && (
          <div className="animate-fade-in w-full text-center">
            {/* 3D Language Orb */}
            <div className="w-full h-[280px] sm:h-[340px] mb-6">
              <Suspense fallback={
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FFBF00]/10 to-[#00FF41]/10 animate-breathe" />
                </div>
              }>
                <LanguageOrb nativeLanguage={nativeLanguage} learningLanguage={learningLanguage} />
              </Suspense>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
              {LANGUAGE_FLAGS[nativeLanguage]} {nativeLanguage} → {LANGUAGE_FLAGS[learningLanguage]} {learningLanguage}
            </h2>
            <p className="text-slate-400 text-sm mb-8 max-w-md mx-auto" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              Your linguistic bridge is configured. Here's how GLOSSOS works:
            </p>

            {/* Instructions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-left">
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:border-[#00FF41]/20 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center text-[#00FF41] font-bold mb-3">1</div>
                <h3 className="text-white font-semibold text-sm mb-1.5" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Initialize Sync</h3>
                <p className="text-slate-500 text-xs leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  Tap the microphone button to connect to your AI language tutor in real-time.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:border-[#FFBF00]/20 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[#FFBF00]/10 border border-[#FFBF00]/20 flex items-center justify-center text-[#FFBF00] font-bold mb-3">2</div>
                <h3 className="text-white font-semibold text-sm mb-1.5" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Speak Freely</h3>
                <p className="text-slate-500 text-xs leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  Speak in {learningLanguage}. Your tutor will respond, correct your pronunciation, and guide you.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:border-[#F5F5F7]/10 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white font-bold mb-3">3</div>
                <h3 className="text-white font-semibold text-sm mb-1.5" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Track Progress</h3>
                <p className="text-slate-500 text-xs leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  Your sessions are saved. Review vocabulary, pronunciation scores, and cognitive analytics.
                </p>
              </div>
            </div>

            {/* Tips */}
            <div className="bg-[#00FF41]/[0.03] border border-[#00FF41]/10 rounded-xl px-5 py-4 mb-8 text-left max-w-md mx-auto">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#00FF41] font-bold mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                Pro Tip
              </p>
              <p className="text-slate-400 text-xs leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                Use the <strong className="text-white">Help Me</strong> button if you get stuck. GLOSSOS will explain in {nativeLanguage} and suggest a response in {learningLanguage}.
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setStep(0)}
                className="px-6 py-3 bg-white/[0.04] border border-white/[0.08] text-slate-300 font-medium rounded-xl transition-all hover:bg-white/[0.06] text-sm"
              >
                ← Back
              </button>
              <button
                onClick={handleComplete}
                className="px-8 py-3 bg-gradient-to-r from-[#FFBF00] to-[#00FF41] hover:from-[#FFBF00]/90 hover:to-[#00FF41]/90 text-black font-bold rounded-xl transition-all uppercase tracking-wider text-sm shadow-lg shadow-[#FFBF00]/20"
              >
                Begin Acquisition →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
