import { describe, it, expect, vi } from "vitest";
import { PaperclipIssueSink } from "../src/voice/sinks/paperclip-issue.js";
import type { TranscriptEvent } from "../src/voice/types.js";

const COMPANY = "co-1";
const AGENT = "agent-alfred";

function ev(text: string, overrides: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    type: "transcript.final",
    provider: "azure_voice_live",
    sessionId: "sess-1",
    discordChannelId: "chan-1",
    speakerId: "user-1",
    text,
    timestamp: "2026-05-31T12:34:56.000Z",
    durationSec: 1.5,
    ...overrides,
  };
}

function mockIssues() {
  return {
    create: vi.fn().mockResolvedValue({ id: "issue-1" }),
    list: vi.fn(),
    get: vi.fn(),
  } as any;
}

describe("PaperclipIssueSink", () => {
  it("creates an issue with title from text + camelCase payload", async () => {
    const issues = mockIssues();
    const sink = new PaperclipIssueSink({
      issues,
      companyId: COMPANY,
      assigneeAgentId: AGENT,
    });

    await sink.post(ev("ship it"));

    expect(issues.create).toHaveBeenCalledOnce();
    const call = issues.create.mock.calls[0][0];
    expect(call.companyId).toBe(COMPANY);
    expect(call.assigneeAgentId).toBe(AGENT);
    expect(call.title).toBe("ship it");
    expect(call.description).toContain("[origin: voice_transcript]");
    expect(call.description).toContain("[provider: azure_voice_live]");
    expect(call.description).toContain("[session: sess-1]");
    expect(call.description).toContain("ship it");
  });

  it("truncates long titles with ellipsis", async () => {
    const issues = mockIssues();
    const sink = new PaperclipIssueSink({
      issues,
      companyId: COMPANY,
      assigneeAgentId: AGENT,
      maxTitleLen: 20,
    });
    await sink.post(ev("a".repeat(50)));

    const call = issues.create.mock.calls[0][0];
    expect(call.title.length).toBeLessThanOrEqual(20);
    expect(call.title.endsWith("…")).toBe(true);
  });

  it("skips empty transcripts", async () => {
    const issues = mockIssues();
    const sink = new PaperclipIssueSink({
      issues,
      companyId: COMPANY,
      assigneeAgentId: AGENT,
    });
    await sink.post(ev(""));
    await sink.post(ev("   \n  "));
    expect(issues.create).not.toHaveBeenCalled();
  });

  it("propagates errors from issues.create", async () => {
    const issues = mockIssues();
    issues.create.mockRejectedValueOnce(new Error("downstream 5xx"));
    const sink = new PaperclipIssueSink({
      issues,
      companyId: COMPANY,
      assigneeAgentId: AGENT,
    });
    await expect(sink.post(ev("oops"))).rejects.toThrow(/downstream 5xx/);
  });

  it("exposes name 'paperclip-issue'", () => {
    const sink = new PaperclipIssueSink({
      issues: mockIssues(),
      companyId: COMPANY,
      assigneeAgentId: AGENT,
    });
    expect(sink.name).toBe("paperclip-issue");
  });
});
