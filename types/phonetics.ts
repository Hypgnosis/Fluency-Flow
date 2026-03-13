export interface PhoneticFeedback {
    phoneme: string;              // e.g., "R" or "θ" (th)
    issue: string;                // What went wrong
    guidance: string;             // How to fix it
    mouthPosition: string;        // Tongue/mouth positioning description
    nativeComparison?: string;    // Similar sound in native language
    practiceWords: string[];      // Words to practice
    difficulty: 'easy' | 'medium' | 'hard';
}

export interface PronunciationAnalysis {
    overallScore: number;         // 0-5 rating
    accuracyPercentage: number;   // 0-100
    feedback: PhoneticFeedback[]; // Detailed per-phoneme feedback
    strengths: string[];          // What they did well
    improvements: string[];       // Quick improvement tips
}

// Extend existing TranscriptionEntry type
export interface TranscriptionEntry {
    id: number;
    speaker: 'You' | 'Tutor';
    text: string;
    isFinal: boolean;
    pronunciationScore?: number;
    audioUrl?: string;
    phoneticAnalysis?: PronunciationAnalysis;  // NEW: Detailed analysis
    timestamp?: number;
}

// Phoneme reference data for visual guides
export interface PhonemeGuide {
    symbol: string;               // IPA symbol
    name: string;                 // Common name
    examples: string[];           // Example words
    tonguePosition: 'front' | 'middle' | 'back';
    lipShape: 'rounded' | 'spread' | 'neutral';
    voicing: 'voiced' | 'unvoiced';
    articulationPoint: string;    // "alveolar ridge", "soft palate", etc.
    visualGuideUrl?: string;      // Optional SVG/image URL
}
