import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './components/AuthModal';
import { LearningSettingsProvider } from './components/shell/LearningSettings';
import { AppShell } from './components/shell/AppShell';
import { Landing } from './components/shell/Landing';
import { LogoMark } from './components/ui/Logo';

const OnboardingPage = lazy(() => import('./components/OnboardingPage'));

const Splash: React.FC = () => (
  <div className="flex min-h-[100dvh] w-full items-center justify-center bg-ink-950">
    <div className="relative flex h-16 w-16 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-gold-500/15" style={{ animationDuration: '1.8s' }} />
      <LogoMark size={36} />
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [onboarded, setOnboarded] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Guests skip onboarding; everyone else does it once per device.
    if (user.isAnonymous || localStorage.getItem('glossos_onboarded') === 'true') setOnboarded(true);
  }, [user]);

  if (loading) return <Splash />;
  if (!user) return <Landing />;

  if (!onboarded) {
    return (
      <Suspense fallback={<Splash />}>
        <OnboardingPage onComplete={() => setOnboarded(true)} />
      </Suspense>
    );
  }

  return (
    <LearningSettingsProvider>
      <AppShell />
    </LearningSettingsProvider>
  );
};

const App: React.FC = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
