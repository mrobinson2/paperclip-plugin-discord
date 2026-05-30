/**
 * War-room voice client (Phase 1, STT inbound only).
 *
 * Joins a Discord voice channel via @discordjs/voice using the custom
 * gateway adapter from ./discord-adapter.ts. For each speaker, listens
 * for an Opus stream that ends after 800 ms of silence (the silence
 * detection IS the VAD — no separate VAD library), decodes to PCM via
 * prism-media, transcribes via Deepgram, and posts the transcript to
 * the war-room text channel via the @Michael (voice) webhook.
 *
 * Out of scope for Phase 1: TTS outbound (Phase 2), per-agent voice
 * lookup (Phase 2), cost guard (Phase 3), latency CI checks (Phase 4).
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { STTAdapter, TextChannelRelay, VoiceClientConfig } from "./types.js";
export declare class WarRoomVoiceClient {
    private connection;
    private readonly ctx;
    private readonly config;
    private readonly stt;
    private readonly relay;
    private readonly silenceMs;
    constructor(ctx: PluginContext, config: VoiceClientConfig, stt?: STTAdapter, relay?: TextChannelRelay);
    /** Join the configured voice channel and start listening. */
    start(): Promise<void>;
    /** Disconnect and clean up. */
    stop(): void;
    private handleUtterance;
}
