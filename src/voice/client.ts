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

import {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
} from "@discordjs/voice";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import prism from "prism-media";
import { randomUUID } from "node:crypto";

import { resample48kTo24k } from "./audio/resample.js";
import { fanOut } from "./sinks/index.js";
import type {
  TranscriptEvent,
  TranscriptSink,
  VoiceClientConfig,
  VoiceProvider,
} from "./types.js";

const DEFAULT_SILENCE_MS = 800;
const PCM_SAMPLE_RATE = 48_000;
const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2; // 16-bit mono
const MIN_UTTERANCE_SEC = 0.2;
const CONNECTION_READY_TIMEOUT_MS = 5_000;

/** Providers whose transcribeUtterance expects 24kHz mono PCM16. */
const PROVIDERS_REQUIRING_24K = new Set(["azure_voice_live"]);

export class WarRoomVoiceClient {
  private connection: VoiceConnection | null = null;
  private readonly ctx: PluginContext;
  private readonly config: VoiceClientConfig;
  private readonly provider: VoiceProvider;
  private readonly sinks: TranscriptSink[];
  private readonly silenceMs: number;
  private readonly sessionId: string;

  constructor(ctx: PluginContext, config: VoiceClientConfig) {
    if (config.sinks.length === 0) {
      throw new Error(
        "WarRoomVoiceClient: at least one TranscriptSink is required",
      );
    }
    this.ctx = ctx;
    this.config = config;
    this.provider = config.provider;
    this.sinks = config.sinks;
    this.silenceMs = config.utteranceEndSilenceMs ?? DEFAULT_SILENCE_MS;
    this.sessionId = randomUUID();
  }

  /** Open the provider session, join the voice channel, start listening. */
  async start(): Promise<void> {
    await this.provider.startSession();

    this.connection = joinVoiceChannel({
      channelId: this.config.voiceChannelId,
      guildId: this.config.guildId,
      adapterCreator: this.config.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true, // Phase 1B is inbound-only
    });

    await entersState(
      this.connection,
      VoiceConnectionStatus.Ready,
      CONNECTION_READY_TIMEOUT_MS,
    );

    const receiver = this.connection.receiver;

    receiver.speaking.on("start", (userId) => {
      this.handleUtterance(userId).catch((err) => {
        this.ctx.logger.error("voice: utterance handling failed", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    this.ctx.logger.info("voice: war-room voice client started", {
      sessionId: this.sessionId,
      provider: this.provider.name,
      sinks: this.sinks.map((s) => s.name),
      guildId: this.config.guildId,
      channelId: this.config.voiceChannelId,
    });
  }

  /** Disconnect and clean up. */
  async stop(): Promise<void> {
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    await this.provider.stopSession();
    this.ctx.logger.info("voice: war-room voice client stopped", {
      sessionId: this.sessionId,
    });
  }

  private async handleUtterance(userId: string): Promise<void> {
    if (!this.connection) return;

    const opusStream = this.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: this.silenceMs,
      },
    });

    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 1,
      rate: PCM_SAMPLE_RATE,
    });

    const chunks: Buffer[] = [];
    return new Promise<void>((resolve) => {
      opusStream
        .pipe(decoder)
        .on("data", (chunk: Buffer) => chunks.push(chunk))
        .on("end", async () => {
          const pcm48 = Buffer.concat(chunks);
          const durationSec = pcm48.length / PCM_BYTES_PER_SECOND;

          if (durationSec < MIN_UTTERANCE_SEC) {
            // Too short to be a real utterance — likely a click or wakeword false-positive.
            resolve();
            return;
          }

          try {
            const audioForProvider = PROVIDERS_REQUIRING_24K.has(this.provider.name)
              ? resample48kTo24k(pcm48)
              : pcm48;

            const text = await this.provider.transcribeUtterance(audioForProvider, {
              userId,
              durationSec,
            });

            const event: TranscriptEvent = {
              type: "transcript.final",
              provider: this.provider.name,
              sessionId: this.sessionId,
              discordChannelId: this.config.voiceChannelId,
              speakerId: userId,
              text,
              timestamp: new Date().toISOString(),
              durationSec,
            };

            await fanOut(event, this.sinks, (sinkName, err) => {
              this.ctx.logger.error("voice: sink failed", {
                sink: sinkName,
                userId,
                error: err.message,
              });
            });
          } catch (err) {
            this.ctx.logger.error("voice: provider failed for utterance", {
              userId,
              durationSec: durationSec.toFixed(2),
              error: err instanceof Error ? err.message : String(err),
            });
          }
          resolve();
        })
        .on("error", (err: Error) => {
          this.ctx.logger.error("voice: decode error", {
            userId,
            error: err.message,
          });
          resolve();
        });
    });
  }
}
