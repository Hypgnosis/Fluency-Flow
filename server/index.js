/**
 * GLOSSOS WebSocket Proxy Server
 * 
 * Keeps the Gemini API key server-side. The client connects to this proxy,
 * and the proxy forwards all messages to/from the Gemini Live API.
 * 
 * Deploy to: Cloud Run, Fly.io, Railway, Render, or any platform that supports WebSocket.
 * 
 * Environment variables:
 *   GEMINI_API_KEY  — Your Gemini API key (required)
 *   PORT            — Server port (default: 8080)
 *   ALLOWED_ORIGINS — Comma-separated list of allowed origins for CORS (default: *)
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

// Load .env in development
try { require('dotenv').config(); } catch (e) { /* dotenv not available in production */ }

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null; // null = allow all (set this in production!)

const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is required');
    process.exit(1);
}

// --- HTTP server for health checks ---
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
    }

    // CORS preflight for WebSocket upgrade
    res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end('GLOSSOS WebSocket Proxy');
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server, path: '/ws' });

let connectionCount = 0;

wss.on('connection', (clientWs, req) => {
    const connId = ++connectionCount;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // --- Origin check ---
    if (ALLOWED_ORIGINS) {
        const origin = req.headers.origin;
        if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
            console.log(`[${connId}] ❌ Blocked origin: ${origin}`);
            clientWs.close(4003, 'Origin not allowed');
            return;
        }
    }

    console.log(`[${connId}] 🔗 Client connected from ${clientIp}`);

    // --- Connect to Gemini ---
    const geminiUrl = `${GEMINI_WS_URL}?key=${GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiUrl);

    let geminiReady = false;
    let clientQueue = []; // Buffer messages until Gemini connection is ready

    // --- Gemini → Client ---
    geminiWs.on('open', () => {
        console.log(`[${connId}] ✅ Connected to Gemini API`);
        geminiReady = true;

        // Flush queued messages
        for (const msg of clientQueue) {
            geminiWs.send(msg);
        }
        clientQueue = [];
    });

    geminiWs.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
        }
    });

    geminiWs.on('error', (err) => {
        console.error(`[${connId}] ❌ Gemini error:`, err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, 'Upstream error');
        }
    });

    geminiWs.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'no reason';
        console.log(`[${connId}] 🔌 Gemini closed: ${code} ${reasonStr}`);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(code, reasonStr);
        }
    });

    // --- Client → Gemini ---
    clientWs.on('message', (data) => {
        if (geminiReady && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(data);
        } else {
            // Buffer until Gemini is connected
            clientQueue.push(data);
        }
    });

    clientWs.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : '';
        console.log(`[${connId}] 👋 Client disconnected: ${code} ${reasonStr}`);
        if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
            geminiWs.close();
        }
    });

    clientWs.on('error', (err) => {
        console.error(`[${connId}] ❌ Client error:`, err.message);
        if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});

// --- Start ---
server.listen(PORT, () => {
    console.log(`\n🚀 GLOSSOS WebSocket Proxy running on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   WebSocket:    ws://localhost:${PORT}/ws`);
    console.log(`   API Key:      ${GEMINI_API_KEY.slice(0, 6)}...(${GEMINI_API_KEY.length} chars)`);
    if (ALLOWED_ORIGINS) {
        console.log(`   Origins:      ${ALLOWED_ORIGINS.join(', ')}`);
    } else {
        console.log(`   Origins:      * (all — set ALLOWED_ORIGINS in production!)`);
    }
    console.log('');
});
