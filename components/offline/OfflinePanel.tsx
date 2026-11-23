import React, { useState } from 'react';
import { ModelManager } from './ModelManager';
import { BenchmarkPanel } from './BenchmarkPanel';

/** Offline tab: model manager, with the benchmark one click away (as in Gallery). */
const OfflinePanel: React.FC = () => {
    const [view, setView] = useState<'models' | 'benchmark'>('models');
    return (
        <div className="h-full overflow-y-auto">
            {view === 'models'
                ? <ModelManager onOpenBenchmark={() => setView('benchmark')} />
                : <BenchmarkPanel onBack={() => setView('models')} />}
        </div>
    );
};

export default OfflinePanel;
