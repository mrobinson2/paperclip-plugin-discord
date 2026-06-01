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
export {};
//# sourceMappingURL=types.js.map