/**
 * Deepgram streaming STT provider.
 *
 * Per-utterance: one WebSocket per call. Send raw 16-bit PCM as binary frames,
 * then send `{"type":"Finalize"}` as a text frame to flush. Read JSON messages
 * until one carries `is_final: true` with the final transcript.
 *
 * In the Phase 1B architecture this provider is a **fallback** — by default,
 * AzureVoiceLiveProvider handles STT. Deepgram only initializes when
 * VOICE_PROVIDER=deepgram OR (VOICE_ENABLE_DEEPGRAM_FALLBACK=true AND
 * Azure Voice Live init fails).
 *
 * API reference: https://developers.deepgram.com/docs/streaming
 */
import { WebSocket } from "ws";
export class DeepgramProvider {
    name = "deepgram";
    apiKey;
    baseUrl;
    model;
    constructor(cfg) {
        this.apiKey = cfg.apiKey;
        this.baseUrl = cfg.baseUrl ?? "wss://api.deepgram.com";
        this.model = cfg.model ?? "nova-2";
    }
    // Per-utterance provider: nothing to open/close at the session level.
    async startSession() { }
    async stopSession() { }
    async transcribeUtterance(pcm, _ctx) {
        const url = `${this.baseUrl}/v1/listen` +
            `?encoding=linear16&sample_rate=48000&channels=1` +
            `&model=${encodeURIComponent(this.model)}&punctuate=true&interim_results=false`;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url, {
                headers: { Authorization: `Token ${this.apiKey}` },
            });
            let finalTranscript = null;
            const cleanup = () => {
                try {
                    ws.close();
                }
                catch {
                    // noop
                }
            };
            ws.on("open", () => {
                ws.send(pcm, { binary: true });
                ws.send(JSON.stringify({ type: "Finalize" }));
            });
            ws.on("message", (data, isBinary) => {
                if (isBinary)
                    return; // Deepgram doesn't send binary back
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.is_final === true &&
                        msg.channel?.alternatives?.[0]?.transcript !== undefined) {
                        finalTranscript = String(msg.channel.alternatives[0].transcript);
                        cleanup();
                    }
                }
                catch {
                    // ignore non-JSON or malformed; rely on close/error path
                }
            });
            ws.on("close", () => {
                if (finalTranscript !== null) {
                    resolve(finalTranscript);
                }
                else {
                    reject(new Error("Deepgram WS closed with no final transcript"));
                }
            });
            ws.on("error", (err) => {
                reject(err);
            });
        });
    }
}
//# sourceMappingURL=deepgram.js.map