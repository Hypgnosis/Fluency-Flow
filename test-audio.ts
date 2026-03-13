import { GoogleGenAI, Modality } from '@google/genai';

const API_KEY = (globalThis as any).process?.env?.API_KEY || 'AIzaSyDkMI4nB0T88P532yUTCJ8rZ-Fde25qjcc';
const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

let session: any = null;
let mediaStream: MediaStream | null = null;
let audioCtxIn: AudioContext | null = null;
let audioCtxOut: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let nextStartTime = 0;
const counts = { msg: 0, audio: 0, trans: 0, sent: 0 };

function log(msg: string, cls = '') {
    const el = document.getElementById('log')!;
    const time = new Date().toLocaleTimeString();
    el.innerHTML += `<span class="${cls}">[${time}] ${msg}</span>\n`;
    el.scrollTop = el.scrollHeight;
    console.log(`[AudioTest] ${msg}`);
}

function setStatus(text: string, color: string) {
    const el = document.getElementById('status')!;
    el.textContent = text;
    el.style.background = color;
}

function updateUI() {
    document.getElementById('msgCount')!.textContent = String(counts.msg);
    document.getElementById('audioCount')!.textContent = String(counts.audio);
    document.getElementById('transCount')!.textContent = String(counts.trans);
    document.getElementById('sentCount')!.textContent = String(counts.sent);
}

function decodeB64(base64: string): Uint8Array {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function float32ToInt16Base64(floatData: Float32Array, srcRate: number): string {
    const ratio = srcRate / 16000;
    const newLen = Math.ceil(floatData.length / ratio);
    const int16 = new Int16Array(newLen);
    for (let i = 0; i < newLen; i++) {
        const idx = Math.floor(i * ratio);
        const s = Math.max(-1, Math.min(1, floatData[idx] || 0));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function startTest() {
    log('=== Starting Audio Test ===', 'info');
    setStatus('CONNECTING...', '#ca8a04');
    document.getElementById('startBtn')!.setAttribute('disabled', 'true');
    document.getElementById('stopBtn')!.removeAttribute('disabled');
    counts.msg = 0; counts.audio = 0; counts.trans = 0; counts.sent = 0;
    updateUI();

    try {
        // Step 1: Microphone
        log('1. Requesting microphone...', 'info');
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        log('   ✅ Mic access granted', 'ok');

        // Step 2: Audio contexts
        audioCtxIn = new AudioContext();
        audioCtxOut = new AudioContext({ sampleRate: 24000 });
        await audioCtxIn.resume();
        await audioCtxOut.resume();
        log(`2. ✅ AudioContexts — In: ${audioCtxIn.sampleRate}Hz (${audioCtxIn.state}), Out: ${audioCtxOut.sampleRate}Hz (${audioCtxOut.state})`, 'ok');

        // Step 3: Connect to Gemini
        log(`3. Connecting to ${MODEL}...`, 'info');
        const ai = new GoogleGenAI({ apiKey: API_KEY });

        session = await ai.live.connect({
            model: MODEL,
            callbacks: {
                onopen: () => {
                    log('   ✅ WebSocket OPEN!', 'ok');
                    setStatus('CONNECTED ● SPEAK NOW', '#059669');
                },
                onmessage: async (msg: any) => {
                    counts.msg++;
                    updateUI();

                    if (msg.setupComplete) {
                        log(`   ✅ [msg #${counts.msg}] setupComplete`, 'ok');
                        return;
                    }

                    if (msg.serverContent) {
                        const sc = msg.serverContent;

                        if (sc.inputTranscription?.text) {
                            counts.trans++;
                            updateUI();
                            log(`   🎤 YOU: "${sc.inputTranscription.text}"`, 'warn');
                        }

                        if (sc.outputTranscription?.text) {
                            counts.trans++;
                            updateUI();
                            log(`   🤖 AI: "${sc.outputTranscription.text}"`, 'ok');
                        }

                        if (sc.modelTurn?.parts) {
                            for (const part of sc.modelTurn.parts) {
                                const data = part?.inlineData?.data;
                                if (data && audioCtxOut) {
                                    try {
                                        if (audioCtxOut.state === 'suspended') await audioCtxOut.resume();
                                        const raw = decodeB64(data);
                                        const int16 = new Int16Array(raw.buffer);
                                        const buf = audioCtxOut.createBuffer(1, int16.length, 24000);
                                        const ch = buf.getChannelData(0);
                                        for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768.0;

                                        const now = audioCtxOut.currentTime;
                                        nextStartTime = Math.max(nextStartTime, now);
                                        const src = audioCtxOut.createBufferSource();
                                        src.buffer = buf;
                                        src.connect(audioCtxOut.destination);
                                        src.start(nextStartTime);
                                        nextStartTime += buf.duration;

                                        counts.audio++;
                                        updateUI();
                                    } catch (e: any) {
                                        log(`   ❌ Audio play error: ${e.message}`, 'err');
                                    }
                                }
                            }
                        }

                        if (sc.turnComplete) {
                            log(`   ✅ [msg #${counts.msg}] Turn complete`, 'ok');
                        }
                    } else {
                        const keys = Object.keys(msg);
                        log(`   📩 [msg #${counts.msg}] keys: ${keys.join(', ')}`, 'info');
                    }
                },
                onerror: (e: any) => {
                    log(`   ❌ WS ERROR: ${e.message || JSON.stringify(e)}`, 'err');
                    setStatus('ERROR', '#dc2626');
                },
                onclose: (e: any) => {
                    log(`   🔌 CLOSED: code=${e.code} reason="${e.reason}"`, e.code === 1000 ? 'info' : 'err');
                    setStatus('DISCONNECTED', '#475569');
                }
            },
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                systemInstruction: 'You are a friendly language tutor. Greet the user briefly and ask how you can help them practice today.',
            },
        });

        log('   ✅ Session ready (ai.live.connect resolved)', 'ok');

        // Step 4: Start streaming mic audio
        const source = audioCtxIn.createMediaStreamSource(mediaStream);
        processor = audioCtxIn.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (event) => {
            const floatData = event.inputBuffer.getChannelData(0);
            const base64 = float32ToInt16Base64(floatData, audioCtxIn!.sampleRate);

            try {
                session.sendRealtimeInput({
                    media: {
                        data: base64,
                        mimeType: 'audio/pcm;rate=16000',
                    }
                });
                counts.sent++;
                if (counts.sent % 25 === 0) updateUI();
            } catch (e: any) {
                if (counts.sent === 0) log(`   ❌ First send failed: ${e.message}`, 'err');
            }
        };

        source.connect(processor);
        const gain = audioCtxIn.createGain();
        gain.gain.value = 0;
        processor.connect(gain);
        gain.connect(audioCtxIn.destination);

        log('4. ✅ Mic streaming started! Speak into your microphone...', 'ok');
        log('', '');
        log('Waiting for AI response...', 'info');

    } catch (err: any) {
        log(`❌ FATAL: ${err.message}`, 'err');
        log(`   ${err.stack}`, 'err');
        setStatus('ERROR', '#dc2626');
        document.getElementById('startBtn')!.removeAttribute('disabled');
        document.getElementById('stopBtn')!.setAttribute('disabled', 'true');
    }
}

function stopTest() {
    log('Stopping...', 'warn');
    try { processor?.disconnect(); } catch (e) { /* */ }
    try { mediaStream?.getTracks().forEach(t => t.stop()); } catch (e) { /* */ }
    try { audioCtxIn?.close(); } catch (e) { /* */ }
    try { audioCtxOut?.close(); } catch (e) { /* */ }
    try { session?.close(); } catch (e) { /* */ }
    session = null; mediaStream = null; audioCtxIn = null; audioCtxOut = null; processor = null;
    nextStartTime = 0;
    setStatus('STOPPED', '#475569');
    document.getElementById('startBtn')!.removeAttribute('disabled');
    document.getElementById('stopBtn')!.setAttribute('disabled', 'true');
    log('Stopped.', 'warn');
}

// Attach to window for HTML button onclick
(window as any)._startTest = startTest;
(window as any)._stopTest = stopTest;

log('Page loaded. SDK imported successfully ✅', 'ok');
log(`Model: ${MODEL}`, 'info');
log(`API Key: ${API_KEY.substring(0, 10)}...`, 'info');
log('Click "Start Test" to begin.', 'info');
