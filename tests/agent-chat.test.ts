import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyInbound, handleAgentChat } from "../src/agent-chat.js";
import { resolveCompanyId } from "../src/company-resolver.js";

vi.mock("../src/company-resolver.js", () => ({
  resolveCompanyId: vi.fn(),
}));

const WAR_ROOM = "1502099355975422082";

function msg(overrides: Record<string, unknown> = {}) {
  return {
    author: { bot: false, username: "michael" },
    content: "hello",
    channel_id: WAR_ROOM,
    ...overrides,
  } as any;
}

describe("classifyInbound", () => {
  const opts = { enableAgentChat: true, warRoomChannelId: WAR_ROOM };

  it("ignores bot messages", () => {
    expect(classifyInbound(msg({ author: { bot: true } }), opts)).toBe("ignore");
  });

  it("routes replies to the existing reply handler", () => {
    expect(
      classifyInbound(msg({ message_reference: { message_id: "123" } }), opts),
    ).toBe("reply");
  });

  it("routes standalone war-room messages to agent chat when enabled", () => {
    expect(classifyInbound(msg(), opts)).toBe("agentChat");
  });

  it("ignores standalone war-room messages when the flag is off", () => {
    expect(
      classifyInbound(msg(), { enableAgentChat: false, warRoomChannelId: WAR_ROOM }),
    ).toBe("ignore");
  });

  it("ignores standalone messages in other channels", () => {
    expect(classifyInbound(msg({ channel_id: "999" }), opts)).toBe("ignore");
  });
});

const COMPANY = "f75ce74d-b1cd-4a64-9f99-9d26b0539d71";
const AGENT = "b9cfea80-98d6-4607-8065-63315103caf4";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    metrics: { write: vi.fn().mockResolvedValue(undefined) },
    agents: {
      list: vi.fn().mockResolvedValue([{ id: AGENT, name: "Alfred" }]),
    },
    issues: { create: vi.fn().mockResolvedValue({ id: "issue-1" }) },
    ...overrides,
  } as any;
}

const OPTS = { baseUrl: "https://api.test", apiKey: "key-123", defaultAgentId: AGENT };

describe("handleAgentChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCompanyId).mockResolvedValue(COMPANY);
  });

  it("creates an issue assigned to the default agent via ctx.issues.create", async () => {
    const ctx = makeCtx();
    await handleAgentChat(ctx, msg({ content: "are you there?" }), OPTS);

    expect(ctx.issues.create).toHaveBeenCalledTimes(1);
    expect(ctx.issues.create).toHaveBeenCalledWith({
      companyId: COMPANY,
      title: "are you there?",
      description: "are you there?",
      assigneeAgentId: AGENT,
    });
  });

  it("ignores empty messages", async () => {
    const ctx = makeCtx();
    await handleAgentChat(ctx, msg({ content: "   " }), OPTS);
    expect(ctx.issues.create).not.toHaveBeenCalled();
  });

  it("skips when the configured agent is not found for the company", async () => {
    const ctx = makeCtx({ agents: { list: vi.fn().mockResolvedValue([{ id: "other", name: "Bob" }]) } });
    await handleAgentChat(ctx, msg({ content: "hi" }), OPTS);
    expect(ctx.issues.create).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("swallows create errors and logs them (fail-soft)", async () => {
    const ctx = makeCtx({ issues: { create: vi.fn().mockRejectedValue(new Error("boom")) } });
    await expect(handleAgentChat(ctx, msg({ content: "hi" }), OPTS)).resolves.toBeUndefined();
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
