/**
 * Azure Voice Live provider — BYOM mode.
 *
 * BYOM ("bring-your-own-model") suppresses Voice Live's built-in LLM/TTS so
 * we only get transcripts. Hermes (via Alfred) generates responses; Voice
 * Live just does STT.
 *
 * The verified config (spike FINDINGS.md, 2026-05-31):
 *   - WSS: wss://<endpoint>/voice-live/realtime?api-version=2026-01-01-preview&model=gpt-realtime-mini
 *   - Auth: api-key header on the upgrade request
 *   - session.update: modalities=["text"], turn_detection=null,
 *     input_audio_transcription={model:"whisper-1"}, input_audio_format="pcm16"
 *   - Stream PCM16 mono 24kHz in input_audio_buffer.append (base64) chunks,
 *     then input_audio_buffer.commit. Do NOT send response.create.
 *   - The transcript arrives as
 *     conversation.item.input_audio_transcription.completed within ~1s.
 *
 * This provider owns a long-running WebSocket. transcribeUtterance() pushes
 * an utterance into the session and awaits its transcription event. A simple
 * mutex serializes calls so the order of commit→completed pairs is unambiguous.
 *
 * Plan: docs/superpowers/plans/2026-05-31-voice-live-refactor.md (mrt-ai-agent-platform).
 */
import type { UtteranceContext, VoiceProvider } from "../types.js";
interface AzureVoiceLiveConfig {
    /** Hostname only, e.g. mrt-voicelive-dev.services.ai.azure.com */
    endpoint: string;
    /** Resource API key. Future: optional when managed identity wiring lands. */
    apiKey: string;
    /** Default: 2026-01-01-preview (spike-verified). */
    apiVersion?: string;
    /** Default: gpt-realtime-mini (spike-verified). */
    model?: string;
    /** Audio chunk send size in bytes. Default: 4800 (100ms @ 24kHz mono PCM16). */
    chunkBytes?: number;
    /** Transcript wait timeout per utterance (ms). Default: 10000. */
    transcribeTimeoutMs?: number;
}
export declare class AzureVoiceLiveProvider implements VoiceProvider {
    readonly name = "azure_voice_live";
    private readonly endpoint;
    private readonly apiKey;
    private readonly apiVersion;
    private readonly model;
    private readonly chunkBytes;
    private readonly transcribeTimeoutMs;
    private ws;
    private pending;
    private chain;
    constructor(cfg: AzureVoiceLiveConfig);
    startSession(): Promise<void>;
    stopSession(): Promise<void>;
    transcribeUtterance(pcm: Buffer, _ctx: UtteranceContext): Promise<string>;
    private doTranscribe;
    private openSocket;
    private completePending;
    private failPending;
}
export {};
