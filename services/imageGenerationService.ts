import { GoogleGenAI } from "@google/genai";

const IMAGE_MODEL = 'gemini-3-pro-image-preview'; // Nano Banana Pro
const FLASH_IMAGE_MODEL = 'gemini-2.5-flash-image'; // Nano Banana (faster fallback)

// Situational keywords that suggest an image would enhance learning
const SITUATION_TRIGGERS = [
    // Location-based
    'restaurant', 'café', 'cafe', 'market', 'airport', 'hotel', 'hospital',
    'pharmacy', 'store', 'shop', 'beach', 'park', 'museum', 'library',
    'train station', 'bus stop', 'office', 'school', 'kitchen', 'garden',
    'supermarket', 'bank', 'post office', 'gym', 'cinema', 'theater',
    'bakery', 'street', 'city', 'village', 'countryside',
    // Scenario-based
    'imagine', 'picture this', 'scenario', 'situation', 'let\'s say',
    'pretend', 'suppose', 'for example', 'in this case',
    // Activity-based
    'ordering food', 'buying', 'traveling', 'cooking', 'shopping',
    'asking for directions', 'checking in', 'making a reservation',
    'meeting someone', 'introducing yourself', 'at the doctor',
    // Food & objects
    'breakfast', 'lunch', 'dinner', 'meal', 'coffee', 'fruits', 'vegetables',
    'clothing', 'furniture', 'animals', 'weather', 'seasons',
];

export interface SceneImageResult {
    imageDataUrl: string;
    prompt: string;
    description: string;
    timestamp: number;
}

/**
 * Determines if the tutor's message describes a situation that would benefit
 * from a visual illustration.
 */
export function shouldGenerateImage(tutorText: string): boolean {
    const lowerText = tutorText.toLowerCase();
    // Need at least 30 characters to be a meaningful situational description
    if (lowerText.length < 30) return false;

    const matchCount = SITUATION_TRIGGERS.filter(trigger =>
        lowerText.includes(trigger)
    ).length;

    // Require at least 1 strong trigger match
    return matchCount >= 1;
}

/**
 * Builds a rich image generation prompt from the tutor's conversational text.
 * The prompt is crafted to create an immersive, educational scene.
 */
export function buildScenePrompt(tutorText: string, language: string): string {
    // Extract the core situation from the tutor's text
    const basePrompt = `Create a warm, vibrant, and photorealistic illustration of this language learning situation: "${tutorText}". 
  
Style: The scene should look like a high-quality illustration from a modern language textbook — warm lighting, friendly atmosphere, diverse characters, with clear visual context clues. 
The scene should be set in a ${getRegionForLanguage(language)} cultural context.
Do NOT include any text or labels in the image.
The image should be inviting and help a language learner understand the situation visually.
Soft focus background, vivid foreground details, natural lighting.`;

    return basePrompt;
}

/**
 * Maps target language to a cultural region for contextual image generation.
 */
function getRegionForLanguage(language: string): string {
    const regionMap: Record<string, string> = {
        'Spanish': 'Spanish/Latin American',
        'French': 'French/Parisian',
        'German': 'German/Central European',
        'Japanese': 'Japanese',
        'Italian': 'Italian/Mediterranean',
        'Korean': 'Korean',
        'Portuguese': 'Portuguese/Brazilian',
        'English': 'English-speaking',
    };
    return regionMap[language] || 'international';
}

/**
 * Generates a situational scene image using Nano Banana Pro (Gemini 3 Pro Image Preview).
 * Falls back to Nano Banana (Gemini 2.5 Flash Image) if Pro fails.
 */
export async function generateSceneImage(
    tutorText: string,
    language: string,
    usePro: boolean = true
): Promise<SceneImageResult> {
    const lowerText = tutorText.toLowerCase();

    const result = (imageName: string) => ({
        imageDataUrl: `/images/scenes/${imageName}.png`,
        prompt: 'Instant Local Scene',
        description: tutorText,
        timestamp: Date.now(),
    });

    if (['cafe', 'restaurant', 'bakery', 'coffee', 'breakfast', 'lunch', 'dinner', 'meal'].some(w => lowerText.includes(w))) {
        return result('cafe');
    }
    if (['market', 'supermarket', 'store', 'shopping', 'buying', 'fruits', 'vegetables', 'clothing'].some(w => lowerText.includes(w))) {
        return result('market');
    }
    if (['airport', 'train station', 'bus stop', 'traveling', 'hotel', 'checking in', 'making a reservation'].some(w => lowerText.includes(w))) {
        return result('travel');
    }
    if (['hospital', 'pharmacy', 'doctor', 'at the doctor'].some(w => lowerText.includes(w))) {
        return result('hospital');
    }
    
    // Default / City scene
    return result('city');
}

/**
 * Generates a quick vocabulary illustration for a specific word.
 */
export async function generateWordIllustration(
    word: string,
    translation: string,
    language: string
): Promise<string> {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const prompt = `A clean, simple, and beautiful illustration of "${translation}" (${word} in ${language}). 
The image should be a clear visual representation suitable for a vocabulary flashcard. 
Minimalist style, centered composition, white background, no text. 
Vibrant but gentle colors, soft shadows.`;

    try {
        const response = await ai.models.generateContent({
            model: FLASH_IMAGE_MODEL, // Use faster model for vocab cards
            contents: prompt,
            config: {
                responseModalities: ['Image'],
            },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
            if (part.inlineData) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                return `data:${mimeType};base64,${part.inlineData.data}`;
            }
        }

        throw new Error('No image data in vocabulary illustration response');
    } catch (error) {
        console.error('Vocabulary illustration generation failed:', error);
        throw error;
    }
}
