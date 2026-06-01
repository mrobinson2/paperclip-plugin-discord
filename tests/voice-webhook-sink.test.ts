import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebhookTextChannelSink } from "../src/voice/sinks/webhook.js";
import type { TranscriptEvent } from "../src/voice/types.js";

const FAKE_URL = "https://discord.example/api/webhooks/123/abc";

function ev(text: string, durationSec = 1.0): TranscriptEvent {
  return {
    type: "transcript.final",
    provider: "azure_voice_live",
    sessionId: "sess-1",
    discordChannelId: "chan-1",
    speakerId: "user-1",
    text,
    timestamp: "2026-05-31T00:00:00.000Z",
    durationSec,
  };
}

describe("WebhookTextChannelSink", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the webhook URL with content and Michael (voice) username", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const sink = new WebhookTextChannelSink({ webhookUrl: FAKE_URL });
    await sink.post(ev("hello alfred", 1.2));

    expect(global.fetch).toHaveBeenCalledOnce();
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const [url, opts] = calls[0] as [string, RequestInit];
    expect(url).toBe(FAKE_URL);
    const body = JSON.parse(opts.body as string);
    expect(body.content).toBe("hello alfred");
    expect(body.username).toBe("Michael (voice)");
  });

  it("retries once on 5xx then succeeds", async () => {
    const mock = global.fetch as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const sink = new WebhookTextChannelSink({ webhookUrl: FAKE_URL });
    await sink.post(ev("retry test"));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 4xx auth failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("invalid webhook token", { status: 401 }),
    );

    const sink = new WebhookTextChannelSink({ webhookUrl: FAKE_URL });
    await expect(sink.post(ev("auth fail"))).rejects.toThrow(/401/);

    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("skips empty transcripts (silence detected, no text)", async () => {
    const sink = new WebhookTextChannelSink({ webhookUrl: FAKE_URL });
    await sink.post(ev(""));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("trims whitespace-only transcripts to empty (also skipped)", async () => {
    const sink = new WebhookTextChannelSink({ webhookUrl: FAKE_URL });
    await sink.post(ev("   \n  "));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses custom username if configured", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const sink = new WebhookTextChannelSink({
      webhookUrl: FAKE_URL,
      username: "Custom Name",
    });
    await sink.post(ev("hi"));

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const [, opts] = calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.username).toBe("Custom Name");
  });

  it("exposes name 'webhook'", () => {
    const sink = new WebhookTextChannelSink({ webhookUrl: FAKE_URL });
    expect(sink.name).toBe("webhook");
  });
});
