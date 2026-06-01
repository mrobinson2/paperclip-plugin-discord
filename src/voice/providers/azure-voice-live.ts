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

import { WebSocket } from "ws";

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

const DEFAULT_API_VERSION = "2026-01-01-preview";
const DEFAULT_MODEL = "gpt-realtime-mini";
const DEFAULT_CHUNK_BYTES = 4800;
const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 10_000;

/** Server event type that carries the final transcript. */
const TRANSCRIPT_EVENT =
  "conversation.item.input_audio_transcription.completed";

interface PendingUtterance {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class AzureVoiceLiveProvider implements VoiceProvider {
  readonly name = "azure_voice_live";

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly model: string;
  private readonly chunkBytes: number;
  private readonly transcribeTimeoutMs: number;

  private ws: WebSocket | null = null;
  private pending: PendingUtterance | null = null;
  // Serializes calls to transcribeUtterance — if two speakers are mid-stream
  // concurrently, the second blocks until the first transcript arrives. This
  // is acceptable for war-room single-speaker patterns and avoids correlating
  // multiple in-flight commits to their transcription events.
  private chain: Promise<void> = Promise.resolve();

  constructor(cfg: AzureVoiceLiveConfig) {
    this.endpoint = cfg.endpoint;
    this.apiKey = cfg.apiKey;
    this.apiVersion = cfg.apiVersion ?? DEFAULT_API_VERSION;
    this.model = cfg.model ?? DEFAULT_MODEL;
    this.chunkBytes = cfg.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this.transcribeTimeoutMs =
      cfg.transcribeTimeoutMs ?? DEFAULT_TRANSCRIBE_TIMEOUT_MS;
  }

  async startSession(): Promise<void> {
    await this.openSocket();
  }

  async stopSession(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close(1000, "stop-session");
      } catch {
        // noop
      }
      this.ws = null;
    }
  }

  async transcribeUtterance(
    pcm: Buffer,
    _ctx: UtteranceContext,
  ): Promise<string> {
    // Chain to the previous utterance so commits don't interleave.
    const myTurn = this.chain.then(() => this.doTranscribe(pcm));
    // Always reset the chain to a resolved promise after the current call,
    // even if it rejects — we don't want a single failure to wedge all future
    // calls behind it.
    this.chain = myTurn.then(
      () => undefined,
      () => undefined,
    );
    return myTurn;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async doTranscribe(pcm: Buffer): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Single auto-reconnect attempt; persistent failure bubbles up.
      await this.openSocket();
    }
    const ws = this.ws;
    if (!ws) {
      throw new Error("AzureVoiceLiveProvider: WebSocket unavailable after reconnect");
    }

    return new Promise<string>((resolve, reject) => {
      if (this.pending) {
        reject(
          new Error(
            "AzureVoiceLiveProvider: pending utterance already in flight (chain bug)",
          ),
        );
        return;
      }

      const timer = setTimeout(() => {
        this.pending = null;
        reject(
          new Error(
            `AzureVoiceLiveProvider: transcription timed out after ${this.transcribeTimeoutMs}ms`,
          ),
        );
      }, this.transcribeTimeoutMs);

      this.pending = { resolve, reject, timer };

      // Stream audio in chunks. Send synchronously — ws.send buffers internally.
      for (let off = 0; off < pcm.length; off += this.chunkBytes) {
        const slice = pcm.subarray(off, Math.min(off + this.chunkBytes, pcm.length));
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: slice.toString("base64"),
          }),
        );
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      // No response.create — BYOM suppression.
    });
  }

  private async openSocket(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const url =
      `wss://${this.endpoint}/voice-live/realtime` +
      `?api-version=${encodeURIComponent(this.apiVersion)}` +
      `&model=${encodeURIComponent(this.model)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { "api-key": this.apiKey },
      });

      let sessionUpdated = false;

      const onOpen = () => {
        // BYOM-mode session.update — verified config from spike FINDINGS.md.
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              modalities: ["text"],
              turn_detection: null,
              input_audio_format: "pcm16",
              input_audio_transcription: { model: "whisper-1" },
            },
          }),
        );
      };

      const onMessage = (raw: WebSocket.RawData) => {
        let msg: { type?: string; transcript?: string; error?: unknown };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.type === "session.updated") {
          if (!sessionUpdated) {
            sessionUpdated = true;
            this.ws = ws;
            resolve();
          }
          return;
        }

        if (msg.type === TRANSCRIPT_EVENT) {
          const text = typeof msg.transcript === "string" ? msg.transcript : "";
          this.completePending(text);
          return;
        }

        if (msg.type === "error") {
          const errStr =
            typeof msg.error === "object" && msg.error
              ? JSON.stringify(msg.error)
              : String(msg.error);
          if (!sessionUpdated) {
            reject(new Error(`AzureVoiceLiveProvider: error before session.updated — ${errStr}`));
            return;
          }
          this.failPending(new Error(`AzureVoiceLiveProvider: server error — ${errStr}`));
        }
      };

      const onClose = (code: number, reason: Buffer) => {
        this.ws = null;
        if (!sessionUpdated) {
          reject(
            new Error(
              `AzureVoiceLiveProvider: WS closed before session.updated (code=${code} reason=${reason.toString() || "(none)"})`,
            ),
          );
          return;
        }
        // Mid-session close: fail any pending utterance. Reconnect happens
        // lazily on next transcribeUtterance call.
        this.failPending(
          new Error(
            `AzureVoiceLiveProvider: WS closed mid-session (code=${code} reason=${reason.toString() || "(none)"})`,
          ),
        );
      };

      const onError = (err: Error) => {
        if (!sessionUpdated) {
          reject(err);
        } else {
          this.failPending(err);
        }
      };

      ws.on("open", onOpen);
      ws.on("message", onMessage);
      ws.on("close", onClose);
      ws.on("error", onError);
    });
  }

  private completePending(text: string): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve(text);
  }

  private failPending(err: Error): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  }
}
