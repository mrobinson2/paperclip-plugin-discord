import { describe, it, expect } from "vitest";
import { classifyInbound } from "../src/agent-chat.js";

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
