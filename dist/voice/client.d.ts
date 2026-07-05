/**
 * War-room voice client (Phase 1B — provider-abstracted STT inbound).
 *
 * Joins a Discord voice channel via @discordjs/voice using the custom gateway
 * adapter from ./discord-adapter.ts. For each speaker, listens for an Opus
 * stream that ends after 800ms of silence (the silence detection IS the VAD —
 * no separate VAD library), decodes to PCM via prism-media, transcribes via
 * the configured VoiceProvider, and fans out the resulting TranscriptEvent
 * to all configured TranscriptSinks.
 *
 * Provider responsibility split:
 *   - DeepgramProvider:        accepts the 48kHz mono PCM as-is
 *   - AzureVoiceLiveProvider:  requires 24kHz mono PCM; this client
 *                              resamples before calling transcribeUtterance
 *
 * Out of scope for Phase 1B: TTS outbound (Phase 2), per-agent voice lookup
 * (Phase 2), cost guard (Phase 3), latency CI checks (Phase 4).
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { VoiceClientConfig } from "./types.js";
export declare class WarRoomVoiceClient {
    private connection;
    private readonly ctx;
    private readonly config;
    private readonly provider;
    private readonly sinks;
    private readonly silenceMs;
    private readonly sessionId;
    constructor(ctx: PluginContext, config: VoiceClientConfig);
    /** Open the provider session, join the voice channel, start listening. */
    start(): Promise<void>;
    /** Disconnect and clean up. */
    stop(): Promise<void>;
    private handleUtterance;
}
