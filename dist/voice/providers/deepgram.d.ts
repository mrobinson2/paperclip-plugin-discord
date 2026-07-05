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
import type { UtteranceContext, VoiceProvider } from "../types.js";
interface DeepgramConfig {
    apiKey: string;
    /** Override the WS base URL; useful for tests. Default: wss://api.deepgram.com */
    baseUrl?: string;
    /** Deepgram model. Default: nova-2 */
    model?: string;
}
export declare class DeepgramProvider implements VoiceProvider {
    readonly name = "deepgram";
    private readonly apiKey;
    private readonly baseUrl;
    private readonly model;
    constructor(cfg: DeepgramConfig);
    startSession(): Promise<void>;
    stopSession(): Promise<void>;
    transcribeUtterance(pcm: Buffer, _ctx: UtteranceContext): Promise<string>;
}
export {};
