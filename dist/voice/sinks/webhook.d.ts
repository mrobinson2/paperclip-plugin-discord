/**
 * POST transcripts to the war-room text channel via webhook, surfaced as
 * "Michael (voice)" so existing Alfred routing picks them up exactly as if
 * Michael had typed them.
 *
 * Discord webhook payload shape: { content, username, avatar_url? }.
 * Success = 204 No Content. We retry once on 5xx; hard-fail 4xx.
 *
 * Empty / whitespace-only transcripts are skipped — nothing meaningful was
 * said and posting noise to the war-room defeats the audit-trail value.
 */
import type { TranscriptEvent, TranscriptSink } from "../types.js";
interface WebhookSinkConfig {
    webhookUrl: string;
    /** Display username for the webhook posts. Default: "Michael (voice)" */
    username?: string;
}
export declare class WebhookTextChannelSink implements TranscriptSink {
    readonly name = "webhook";
    private readonly webhookUrl;
    private readonly username;
    constructor(cfg: WebhookSinkConfig);
    post(event: TranscriptEvent): Promise<void>;
}
export {};
