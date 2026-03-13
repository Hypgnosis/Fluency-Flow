import { PhoneticFeedback, PronunciationAnalysis } from '../types';

/**
 * Parses AI text response to extract phonetic feedback
 * This is a simplified parser - in production, you might use structured output from Gemini
 */
export function parsePhoneticFeedback(aiResponse: string): PronunciationAnalysis | null {
    // Check if response contains phonetic feedback keywords
    if (!aiResponse.toLowerCase().includes('pronunciation') &&
        !aiResponse.toLowerCase().includes('sound') &&
        !aiResponse.toLowerCase().includes('phoneme')) {
        return null;
    }

    // Extract overall score/accuracy if mentioned
    const accuracyMatch = aiResponse.match(/(\d+)%\s*(accuracy|correct)/i);
    const accuracyPercentage = accuracyMatch ? parseInt(accuracyMatch[1]) : 75;

    // Simple heuristic scoring based on keywords
    let overallScore = 3.5;
    if (aiResponse.toLowerCase().includes('excellent') || aiResponse.toLowerCase().includes('perfect')) {
        overallScore = 5;
    } else if (aiResponse.toLowerCase().includes('good') || aiResponse.toLowerCase().includes('well done')) {
        overallScore = 4;
    } else if (aiResponse.toLowerCase().includes('issue') || aiResponse.toLowerCase().includes('problem')) {
        overallScore = 3;
    }

    // Extract strengths (what they did well)
    const strengths: string[] = [];
    if (aiResponse.toLowerCase().includes('did well') || aiResponse.toLowerCase().includes('good job')) {
        const strengthsMatch = aiResponse.match(/(?:did well|good job|strength)[:\s]+([^.!?]+)/i);
        if (strengthsMatch) {
            strengths.push(strengthsMatch[1].trim());
        }
    }

    // Extract improvements
    const improvements: string[] = [];
    if (aiResponse.toLowerCase().includes('improve') || aiResponse.toLowerCase().includes('try')) {
        const improvementsMatch = aiResponse.match(/(?:improve|try|practice)[:\s]+([^.!?]+)/gi);
        if (improvementsMatch) {
            improvements.push(...improvementsMatch.map(m => m.replace(/^(?:improve|try|practice)[:\s]+/i, '').trim()));
        }
    }

    // Parse detailed feedback (simplified)
    const feedback: PhoneticFeedback[] = [];

    // Look for phoneme mentions (R, L, TH, etc.)
    const phonemePatterns = [
        { regex: /\b(['\"]?)([rlthsz])\1\b/gi, difficulty: 'medium' as const },
        { regex: /\b(rolling r|trilled r|rr)\b/gi, difficulty: 'hard' as const },
        { regex: /\b(th|θ|ð)\b/gi, difficulty: 'medium' as const },
    ];

    phonemePatterns.forEach(pattern => {
        const matches = aiResponse.match(pattern.regex);
        if (matches && matches.length > 0) {
            const phoneme = matches[0].replace(/['"]/g, '').toUpperCase();

            // Extract context around the phoneme
            const contextMatch = aiResponse.match(new RegExp(`([^.!?]*${matches[0]}[^.!?]*)`, 'i'));
            const context = contextMatch ? contextMatch[1].trim() : '';

            // Extract practice words if mentioned
            const practiceMatch = aiResponse.match(/(?:practice|try)[:\s]+([^.!?]+)/i);
            const practiceWords = practiceMatch
                ? practiceMatch[1].split(',').map(w => w.trim().replace(/['"]/g, '')).slice(0, 3)
                : [];

            feedback.push({
                phoneme: phoneme,
                issue: context || `Your ${phoneme} sound needs improvement`,
                guidance: extractGuidance(aiResponse, phoneme),
                mouthPosition: extractMouthPosition(aiResponse, phoneme),
                nativeComparison: extractNativeComparison(aiResponse),
                practiceWords: practiceWords.length > 0 ? practiceWords : generatePracticeWords(phoneme),
                difficulty: pattern.difficulty
            });
        }
    });

    if (feedback.length === 0 && strengths.length === 0 && improvements.length === 0) {
        return null; // No meaningful feedback extracted
    }

    return {
        overallScore,
        accuracyPercentage,
        feedback,
        strengths: strengths.length > 0 ? strengths : ['Clear articulation', 'Good pacing'],
        improvements: improvements.length > 0 ? improvements : ['Keep practicing daily', 'Focus on difficult sounds']
    };
}

function extractGuidance(text: string, phoneme: string): string {
    // Look for positioning instructions
    const positionMatch = text.match(/(?:place|position|put)[^.!?]+(?:tongue|mouth|lips)[^.!?]+/i);
    if (positionMatch) {
        return positionMatch[0].trim();
    }

    return `Focus on the ${phoneme} sound. Pay attention to tongue and mouth positioning.`;
}

function extractMouthPosition(text: string, phoneme: string): string {
    const positionMatch = text.match(/(?:tongue|mouth|lips)[^.!?]+(?:against|near|on|at)[^.!?]+/i);
    if (positionMatch) {
        return positionMatch[0].trim();
    }

    // Default positions for common phonemes
    const defaultPositions: Record<string, string> = {
        'R': 'Place tongue tip near alveolar ridge, curl slightly back',
        'L': 'Press tongue tip against alveolar ridge, let air flow around sides',
        'TH': 'Place tongue between teeth, blow air gently',
        'S': 'Keep tongue near alveolar ridge, create narrow channel for air',
        'Z': 'Same as S but add voice vibration',
    };

    return defaultPositions[phoneme] || 'Focus on proper tongue and mouth positioning';
}

function extractNativeComparison(text: string): string | undefined {
    const comparisonMatch = text.match(/(?:similar to|like|sounds like)[^.!?]+(?:English|native)[^.!?]+/i);
    if (comparisonMatch) {
        return comparisonMatch[0].trim();
    }
    return undefined;
}

function generatePracticeWords(phoneme: string): string[] {
    const wordSets: Record<string, string[]> = {
        'R': ['red', 'run', 'free'],
        'L': ['light', 'love', 'fall'],
        'TH': ['think', 'this', 'weather'],
        'S': ['sun', 'class', 'pass'],
        'Z': ['zero', 'fuzzy', 'jazz'],
        'RR': ['perro', 'carro', 'ferrocarril'], // Spanish
    };

    return wordSets[phoneme] || ['practice', 'repeat', 'listen'];
}

/**
 * Generates a URL to fetch native speaker audio for a word
 * This is a placeholder - in production you would:
 * 1. Use Google Cloud Text-to-Speech API
 * 2. Pre-recorded audio database
 * 3. Other TTS services
 */
export async function getNativeAudioUrl(word: string, language: string): Promise<string | undefined> {
    // For now, return undefined - Phase 4 can integrate with actual TTS service
    // Example integration with Google TTS would go here:
    /*
    const response = await fetch('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ word, language })
    });
    const audioBlob = await response.blob();
    return URL.createObjectURL(audioBlob);
    */

    return undefined;
}

/**
 * Mock function to simulate detailed pronunciation analysis
 * In production, this would come from Gemini's structured output
 */
export function createMockPhoneticAnalysis(): PronunciationAnalysis {
    return {
        overallScore: 3.8,
        accuracyPercentage: 76,
        feedback: [
            {
                phoneme: 'R',
                issue: 'Your Spanish "rr" sounded too much like an English "r"',
                guidance: 'For the trilled "rr", place your tongue against your upper teeth and let it vibrate rapidly. Start with a single tap and build up to multiple vibrations.',
                mouthPosition: 'Tongue tip touches alveolar ridge (bumpy area behind front teeth). Relax tongue and let airflow cause it to vibrate.',
                nativeComparison: 'Similar to the "tt" sound in American English "butter" or "water" - that quick tongue tap.',
                practiceWords: ['perro', 'carro', 'ferrocarril'],
                difficulty: 'hard'
            },
            {
                phoneme: 'J',
                issue: 'The "j" sound came out too much like English "h"',
                guidance: 'Spanish "j" is more guttural. It comes from the back of the throat, similar to clearing your throat gently.',
                mouthPosition: 'Raise the back of your tongue toward your soft palate. Create friction as air passes through.',
                nativeComparison: 'Like the "ch" in Scottish "loch" or German "Bach", but softer.',
                practiceWords: ['jamón', 'jueves', 'jugar'],
                difficulty: 'medium'
            }
        ],
        strengths: [
            'Your vowel pronunciation was clear and accurate',
            'Good rhythm and pacing throughout',
            'Consonant clusters were handled well'
        ],
        improvements: [
            'Practice the trilled "rr" sound daily - start with single taps',
            'Record yourself and compare to native speakers',
            'Focus on the guttural "j" - it should feel deeper in your throat'
        ]
    };
}
