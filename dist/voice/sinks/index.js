/**
 * Sink fan-out helper.
 *
 * Runs all configured sinks concurrently via Promise.allSettled — one sink
 * failing does not block others. Per-sink failures are reported via the
 * `onSinkError` callback so callers (the WarRoomVoiceClient) can route them
 * through their normal logger without sinks knowing about logging.
 */
export { WebhookTextChannelSink } from "./webhook.js";
export { PaperclipIssueSink } from "./paperclip-issue.js";
export async function fanOut(event, sinks, onSinkError) {
    const results = await Promise.allSettled(sinks.map((s) => s.post(event)));
    results.forEach((r, i) => {
        if (r.status === "rejected") {
            const err = r.reason instanceof Error ? r.reason : new Error(String(r.reason));
            onSinkError(sinks[i].name, err);
        }
    });
}
//# sourceMappingURL=index.js.map