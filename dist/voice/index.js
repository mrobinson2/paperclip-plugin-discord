/**
 * Public exports for the war-room voice subsystem (Phase 1B).
 * Plan: ../../docs/superpowers/plans/2026-05-31-voice-live-refactor.md
 *       (in the MRTek mrt-ai-agent-platform repo)
 */
export { WarRoomVoiceClient } from "./client.js";
export { createPluginDiscordAdapter } from "./discord-adapter.js";
// Providers
export { AzureVoiceLiveProvider, DeepgramProvider, buildPrimaryProvider, buildFallbackProvider, startWithFallback, } from "./providers/index.js";
// Sinks
export { WebhookTextChannelSink, PaperclipIssueSink, fanOut, } from "./sinks/index.js";
//# sourceMappingURL=index.js.map