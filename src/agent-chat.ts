import type { MessageCreateEvent } from "./gateway.js";

export type InboundKind = "reply" | "agentChat" | "ignore";

/**
 * Decide how an inbound gateway message should be handled. Pure function so the
 * routing rules are unit-testable in isolation from the gateway and SDK.
 */
export function classifyInbound(
  message: MessageCreateEvent,
  opts: { enableAgentChat: boolean; warRoomChannelId: string },
): InboundKind {
  if (message.author.bot) return "ignore";
  if (message.message_reference?.message_id) return "reply";
  if (opts.enableAgentChat && message.channel_id === opts.warRoomChannelId) {
    return "agentChat";
  }
  return "ignore";
}
