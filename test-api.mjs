// Quick test to verify Gemini API key and Live API connectivity
import { GoogleGenAI } from "@google/genai";

const API_KEY = "AIzaSyDkMI4nB0T88P532yUTCJ8rZ-Fde25qjcc";

async function testBasicGeneration() {
    console.log("=== Test 1: Basic Text Generation ===");
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Say hello in one word",
        });
        console.log("✅ Basic generation works:", response.text?.substring(0, 50));
    } catch (err) {
        console.log("❌ Basic generation failed:", err.message);
    }
}

async function testLiveConnect() {
    console.log("\n=== Test 2: Live API Connection ===");
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    const models = [
        "gemini-2.5-flash-native-audio-preview-12-2025",
        "gemini-live-2.5-flash-preview-native-audio",
        "gemini-2.0-flash-live-001",
    ];

    for (const model of models) {
        console.log(`\nTrying model: ${model}`);
        try {
            const session = await ai.live.connect({
                model: model,
                callbacks: {
                    onopen: () => console.log(`  ✅ Connected to ${model}!`),
                    onmessage: (msg) => {
                        if (msg.serverContent?.outputTranscription?.text) {
                            console.log(`  📝 AI says: ${msg.serverContent.outputTranscription.text}`);
                        }
                        if (msg.setupComplete) {
                            console.log(`  ✅ Setup complete for ${model}`);
                        }
                    },
                    onerror: (e) => console.log(`  ❌ Error: ${e.message}`),
                    onclose: (e) => console.log(`  🔌 Closed: code=${e.code} reason=${e.reason}`),
                },
                config: {
                    responseModalities: ["AUDIO"],
                    systemInstruction: "Say hello briefly",
                },
            });

            // Wait 5 seconds to see if connection works
            await new Promise(resolve => setTimeout(resolve, 5000));
            session.close();
            console.log(`  ✅ Model ${model} works! Session closed cleanly.`);
            break; // Found a working model
        } catch (err) {
            console.log(`  ❌ ${model} failed: ${err.message}`);
        }
    }
}

await testBasicGeneration();
await testLiveConnect();

console.log("\n=== Tests complete ===");
process.exit(0);
