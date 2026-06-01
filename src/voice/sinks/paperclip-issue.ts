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

const DEFAULT_MAX_TITLE_LEN = 80;

export class PaperclipIssueSink implements TranscriptSink {
  readonly name = "paperclip-issue";

  private readonly issues: PluginIssuesClient;
  private readonly companyId: string;
  private readonly assigneeAgentId: string;
  private readonly maxTitleLen: number;

  constructor(cfg: PaperclipIssueSinkConfig) {
    this.issues = cfg.issues;
    this.companyId = cfg.companyId;
    this.assigneeAgentId = cfg.assigneeAgentId;
    this.maxTitleLen = cfg.maxTitleLen ?? DEFAULT_MAX_TITLE_LEN;
  }

  async post(event: TranscriptEvent): Promise<void> {
    const trimmed = event.text.trim();
    if (trimmed.length === 0) {
      // Empty transcripts produce no issue — same skip policy as the webhook sink.
      return;
    }

    const title = trimmed.length > this.maxTitleLen
      ? trimmed.slice(0, this.maxTitleLen - 1).trimEnd() + "…"
      : trimmed;

    // Origin metadata embedded in the description preamble so it survives
    // even if PaperClip's wider issue schema doesn't model "origin" yet.
    const description =
      `[origin: voice_transcript]\n` +
      `[provider: ${event.provider}]\n` +
      `[session: ${event.sessionId}]\n` +
      `[speaker: ${event.speakerId}]\n` +
      `[discordChannel: ${event.discordChannelId}]\n` +
      `[timestamp: ${event.timestamp}]\n` +
      `[durationSec: ${event.durationSec.toFixed(2)}]\n\n` +
      trimmed;

    await this.issues.create({
      companyId: this.companyId,
      assigneeAgentId: this.assigneeAgentId,
      title,
      description,
    });
  }
}
