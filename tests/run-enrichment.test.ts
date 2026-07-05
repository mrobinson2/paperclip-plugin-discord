import { describe, it, expect, vi } from "vitest";
import { enrichRunEventPayload } from "../src/worker.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";

// Run lifecycle events from core carry only UUIDs — the worker resolves the
// human labels (agentName, issueIdentifier, issueTitle) the formatters use.

const AGENT_ID = "b9cfea80-98d6-4607-8065-63315103caf4";
const ISSUE_ID = "a50714f9-3f67-4dae-ac70-3cbfe26e7c3b";

function makeCtx(overrides: Partial<Record<string, unknown>> = {}): PluginContext {
  return {
    agents: {
      list: vi.fn().mockResolvedValue([{ id: AGENT_ID, name: "Alfred" }]),
    },
    issues: {
      get: vi.fn().mockResolvedValue({ identifier: "MRT-387", title: "Router smoke test" }),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as unknown as PluginContext;
}

function makeRunEvent(payload: Record<string, unknown>): PluginEvent {
  return {
    eventType: "agent.run.started",
    companyId: "company-1",
    entityId: "run-1",
    occurredAt: "2026-07-05T22:00:00Z",
    payload,
  } as PluginEvent;
}

describe("enrichRunEventPayload", () => {
  it("resolves agentName and issue identifier/title from UUIDs", async () => {
    const ctx = makeCtx();
    const payload = await enrichRunEventPayload(ctx, makeRunEvent({ agentId: AGENT_ID, issueId: ISSUE_ID }));
    expect(payload.agentName).toBe("Alfred");
    expect(payload.issueIdentifier).toBe("MRT-387");
    expect(payload.issueTitle).toBe("Router smoke test");
    expect(payload.issueId).toBe(ISSUE_ID); // preserved for the View Issue link
  });

  it("does not overwrite labels already present in the payload", async () => {
    const ctx = makeCtx();
    const payload = await enrichRunEventPayload(
      ctx,
      makeRunEvent({ agentId: AGENT_ID, agentName: "Custom", issueId: ISSUE_ID, issueIdentifier: "X-1", issueTitle: "Kept" }),
    );
    expect(payload.agentName).toBe("Custom");
    expect(payload.issueIdentifier).toBe("X-1");
    expect(payload.issueTitle).toBe("Kept");
    expect((ctx.agents.list as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((ctx.issues.get as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("skips lookups when the payload has no ids", async () => {
    const ctx = makeCtx();
    const payload = await enrichRunEventPayload(ctx, makeRunEvent({}));
    expect(payload.agentName).toBeUndefined();
    expect((ctx.agents.list as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("fails soft when a lookup throws — notification still posts", async () => {
    const ctx = makeCtx({
      agents: { list: vi.fn().mockRejectedValue(new Error("api down")) },
    });
    const payload = await enrichRunEventPayload(ctx, makeRunEvent({ agentId: AGENT_ID, issueId: ISSUE_ID }));
    expect(payload.agentId).toBe(AGENT_ID); // original payload intact
    expect(ctx.logger.debug).toHaveBeenCalled();
  });

  it("leaves unknown agent ids unresolved rather than guessing", async () => {
    const ctx = makeCtx();
    const payload = await enrichRunEventPayload(ctx, makeRunEvent({ agentId: "0000-not-in-roster" }));
    expect(payload.agentName).toBeUndefined();
  });
});
