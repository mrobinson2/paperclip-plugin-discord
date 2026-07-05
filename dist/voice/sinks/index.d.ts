/**
 * Sink fan-out helper.
 *
 * Runs all configured sinks concurrently via Promise.allSettled — one sink
 * failing does not block others. Per-sink failures are reported via the
 * `onSinkError` callback so callers (the WarRoomVoiceClient) can route them
 * through their normal logger without sinks knowing about logging.
 */
import type { TranscriptEvent, TranscriptSink } from "../types.js";
export { WebhookTextChannelSink } from "./webhook.js";
export { PaperclipIssueSink } from "./paperclip-issue.js";
export declare function fanOut(event: TranscriptEvent, sinks: TranscriptSink[], onSinkError: (sinkName: string, err: Error) => void): Promise<void>;
