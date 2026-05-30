/**
 * Deepgram streaming STT adapter.
 *
 * One WebSocket per utterance. Send raw 16-bit PCM as binary frames,
 * then send `{"type":"Finalize"}` as a text frame to flush. Read JSON
 * messages until one carries `is_final: true` with the final transcript.
 *
 * API reference: https://developers.deepgram.com/docs/streaming
 */
import type { STTAdapter } from "./types.js";
interface DeepgramConfig {
    apiKey: string;
    /** Override the WS base URL; useful for tests. Default: wss://api.deepgram.com */
    baseUrl?: string;
    /** Deepgram model. Default: nova-2 */
    model?: string;
}
export declare class DeepgramSTTAdapter implements STTAdapter {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly model;
    constructor(cfg: DeepgramConfig);
    transcribeUtterance(pcm: Buffer): Promise<string>;
}
export {};
