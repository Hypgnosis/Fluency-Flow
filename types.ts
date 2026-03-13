export interface TranscriptionEntry {
  id: number;
  speaker: 'You' | 'Tutor';
  text: string;
  isFinal: boolean;
  pronunciationScore?: number;
  audioUrl?: string;
  phoneticAnalysis?: import('./types/phonetics').PronunciationAnalysis;
  timestamp?: number;
  sceneImageUrl?: string;          // Nano Banana Pro generated scene image
  isGeneratingImage?: boolean;      // Loading state for image generation
}

// Re-export phonetic types
export type { PhoneticFeedback, PronunciationAnalysis, PhonemeGuide } from './types/phonetics';

// Re-export vision types
export type { VocabularyCard, VisionAnalysisResult, CameraState } from './types/vision';
