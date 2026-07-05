/**
 * Create PaperClip issues from transcripts.
 *
 * Programmatic counterpart to the war-room TEXT webhook sink:
 *   - Webhook sink → human-visible audit trail in Discord
 *   - This sink     → machine-routable task in PaperClip, assigned to Alfred
 *
 * Alfred wakes on issue assignment (per PaperClip's normal flow), spawns
 * Hermes via ACP, and processes the transcript as a normal task. The
 * "voice_transcript" origin flag is captured in metadata via the description
 * preamble so downstream consumers can distinguish voice-originated work
 * from typed work.
 *
 * Uses the plugin SDK's PluginIssuesClient — no direct REST. This means
 * everything that issues.create() does (validation, casing, identifier
 * generation, activity log entries) happens transparently.
 *
 * camelCase is the only valid casing for PaperClip's issue API (per
 * CLAUDE.md #16 — snake_case is silently dropped by upstream Zod). The
 * plugin SDK enforces this at the type level.
 */
import type { PluginIssuesClient } from "@paperclipai/plugin-sdk";
import type { TranscriptEvent, TranscriptSink } from "../types.js";
interface PaperclipIssueSinkConfig {
    /** Plugin SDK issues client (ctx.issues). */
    issues: PluginIssuesClient;
    /** Company UUID. */
    companyId: string;
    /** Agent UUID to assign each issue to (typically Alfred). */
    assigneeAgentId: string;
    /** Max title length (PaperClip soft limit is ~80 chars). Default: 80. */
    maxTitleLen?: number;
}
export declare class PaperclipIssueSink implements TranscriptSink {
    readonly name = "paperclip-issue";
    private readonly issues;
    private readonly companyId;
    private readonly assigneeAgentId;
    private readonly maxTitleLen;
    constructor(cfg: PaperclipIssueSinkConfig);
    post(event: TranscriptEvent): Promise<void>;
}
export {};
