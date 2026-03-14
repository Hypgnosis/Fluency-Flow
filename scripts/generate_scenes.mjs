import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// All triggers from imageGenerationService
const SITUATION_TRIGGERS = [
    'restaurant', 'cafe', 'market', 'airport', 'hotel', 'hospital',
    'pharmacy', 'store', 'beach', 'park', 'museum', 'library',
    'train station', 'office', 'school', 'kitchen', 'garden',
    'supermarket', 'bank', 'gym', 'cinema',
    'bakery', 'street', 'city', 'countryside',
    // Activity-based abstractions
    'ordering food', 'shopping', 'asking for directions',
    'checking in', 'at the doctor',
];

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("No API key found in .env.local");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const OUT_DIR = path.join(__dirname, "../public/images/scenes");

async function generateSceneForTrigger(trigger) {
    const filename = trigger.replace(/\s+/g, "_") + ".png";
    const filePath = path.join(OUT_DIR, filename);

    // Skip if existing
    try {
        await fs.access(filePath);
        console.log(`[SKIP] Image already exists for: ${trigger}`);
        return;
    } catch (e) {
        // File doesn't exist, proceed
    }

    const prompt = `Create a warm, vibrant, and photorealistic illustration of this language learning situation: "a typical scene at a ${trigger}".
Style: The scene should look like a high-quality illustration from a modern language textbook — warm lighting, friendly atmosphere, diverse characters, with clear visual context clues. The scene should be set in an international cultural context.
Do NOT include any text or labels in the image.
The image should be inviting and help a language learner understand the situation visually.
Soft focus background, vivid foreground details, natural lighting.`;

    console.log(`[START] Generating image for: ${trigger}`);
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image", // Faster generation for caching
            contents: prompt,
            config: {
                responseModalities: ["IMAGE"],
            },
        });

        const part = response.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData) {
            const buffer = Buffer.from(part.inlineData.data, 'base64');
            await fs.writeFile(filePath, buffer);
            console.log(`[SUCCESS] Saved image for: ${trigger}`);
        } else {
            console.error(`[FAIL] No image data returned for: ${trigger}`);
        }
    } catch (err) {
        console.error(`[ERROR] Failed for ${trigger}:`, err.message);
    }
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    
    // Concurrency limiting
    const CONCURRENCY = 4;
    for (let i = 0; i < SITUATION_TRIGGERS.length; i += CONCURRENCY) {
        const chunk = SITUATION_TRIGGERS.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(trigger => generateSceneForTrigger(trigger)));
    }
    
    console.log("All finished!");
}

main().catch(console.error);
