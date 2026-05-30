/**
 * POST utterance transcripts to the war-room text channel via webhook,
 * surfaced as "Michael (voice)" so existing Alfred routing picks them up
 * exactly as if Michael had typed them.
 *
 * Discord webhook payload shape: { content, username, avatar_url? }.
 * Success = 204 No Content. We retry once on 5xx; hard-fail 4xx.
 *
 * Empty / whitespace-only transcripts are skipped — nothing meaningful
 * was said and posting noise to the war-room defeats the audit-trail value.
 */
import type { TextChannelRelay } from "./types.js";
interface RelayConfig {
    webhookUrl: string;
    /** Display username for the webhook posts. Default: "Michael (voice)" */
    username?: string;
}
export declare class WebhookTextChannelRelay implements TextChannelRelay {
    private readonly webhookUrl;
    private readonly username;
    constructor(cfg: RelayConfig);
    postTranscript(text: string, _metadata: {
        durationSec: number;
    }): Promise<void>;
}
export {};
