/**
 * Shared types for the war-room voice client.
 *
 * Phase 1B: provider-abstracted architecture.
 *   - VoiceProvider: pluggable STT backend (Azure Voice Live default, Deepgram fallback)
 *   - TranscriptEvent: neutral transcript shape; same regardless of provider
 *   - TranscriptSink: where transcripts go (webhook for audit, PaperClip /api/issues
 *     for programmatic Hermes routing)
 *
 * Plan: docs/superpowers/plans/2026-05-31-voice-live-refactor.md
 *       (in the MRTek mrt-ai-agent-platform repo)
 */
import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
/**
 * A pluggable speech-to-text backend.
 *
 * Two shapes the interface must support:
 *   - **Per-utterance** providers (e.g. Deepgram) open a fresh connection per
 *     call. `startSession` and `stopSession` are no-ops.
 *   - **Session-based** providers (e.g. Azure Voice Live) own a long-running
 *     WebSocket. `startSession` opens it; `transcribeUtterance` pushes audio
 *     into the open session.
 *
 * Both shapes present the same per-utterance external contract — callers
 * (e.g. WarRoomVoiceClient) don't need to know which they have.
 */
export interface VoiceProvider {
    /** Provider identifier — appears in TranscriptEvent.provider. */
    readonly name: string;
    /** Open any long-running resources. No-op for per-utterance providers. */
    startSession(): Promise<void>;
    /**
     * Transcribe one utterance.
     *
     * @param pcm  Raw audio buffer. The provider documents its required format.
     *             AzureVoiceLiveProvider expects PCM16 mono 24kHz (caller resamples).
     *             DeepgramProvider accepts PCM16 mono 48kHz (no resample).
     * @returns    Final transcript text (UTF-8). Empty string is valid (no speech).
     * @throws     On transport failure, auth failure, or session collapse.
     */
    transcribeUtterance(pcm: Buffer, ctx: UtteranceContext): Promise<string>;
    /** Release any long-running resources. No-op for per-utterance providers. */
    stopSession(): Promise<void>;
}
export interface UtteranceContext {
    /** Discord user ID who spoke. */
    userId: string;
    /** Approximate utterance duration in seconds (computed from PCM length). */
    durationSec: number;
}
/**
 * Neutral transcript event emitted by WarRoomVoiceClient and consumed by sinks.
 *
 * Provider-agnostic by design: a sink that posts to a Discord webhook and a
 * sink that creates a PaperClip issue both see the same shape.
 */
export interface TranscriptEvent {
    /** Always "transcript.final" for Phase 1B (no partials yet). */
    readonly type: "transcript.final";
    /** Which provider produced this transcript. */
    readonly provider: string;
    /** Stable session ID for the WarRoomVoiceClient lifetime. */
    readonly sessionId: string;
    /** Discord voice channel ID where the audio originated. */
    readonly discordChannelId: string;
    /** Discord user ID who spoke. */
    readonly speakerId: string;
    /** Transcript text. */
    readonly text: string;
    /** ISO8601 timestamp at finalization. */
    readonly timestamp: string;
    /** Approximate utterance duration in seconds. */
    readonly durationSec: number;
}
/**
 * A destination for transcript events. Sinks run concurrently via
 * Promise.allSettled — one failing does not block others.
 */
export interface TranscriptSink {
    /** Sink identifier — used in startup logs and per-sink failure reporting. */
    readonly name: string;
    /** Deliver a transcript. Throw on failure; caller logs and continues. */
    post(event: TranscriptEvent): Promise<void>;
}
export interface VoiceClientConfig {
    /** Discord guild (server) ID. */
    guildId: string;
    /** Discord voice channel ID to join on startup. */
    voiceChannelId: string;
    /** Provider for STT. */
    provider: VoiceProvider;
    /** One or more transcript sinks. Empty array is rejected at startup. */
    sinks: TranscriptSink[];
    /** Silence duration (ms) that ends an utterance. Default: 800. */
    utteranceEndSilenceMs?: number;
    /** Voice connection adapter from the host SDK / gateway. */
    voiceAdapterCreator: DiscordGatewayAdapterCreator;
}
