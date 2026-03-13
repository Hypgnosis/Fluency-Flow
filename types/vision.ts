export interface VocabularyCard {
    id: string;
    word: string;                    // Target language word
    translation: string;             // English translation
    pronunciation?: string;          // IPA or phonetic guide
    exampleSentence?: string;       // Usage example
    imageDataUrl?: string;          // Captured photo of object
    partOfSpeech?: string;          // noun, verb, adjective, etc.
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
    timestamp: number;
    language: string;
}

export interface VisionAnalysisResult {
    detectedObjects: string[];      // Objects found in image
    primaryObject: string;           // Main object to teach
    vocabularyCard: VocabularyCard;
    confidence: number;              // 0-1 confidence score
    context?: string;                // Additional context from AI
}

export interface CameraState {
    isActive: boolean;
    hasPermission: boolean;
    error: string | null;
    facingMode: 'user' | 'environment';
}
