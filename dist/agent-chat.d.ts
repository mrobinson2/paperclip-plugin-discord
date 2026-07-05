import type { MessageCreateEvent } from "./gateway.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
export type InboundKind = "reply" | "agentChat" | "ignore";
/**
 * Decide how an inbound gateway message should be handled. Pure function so the
 * routing rules are unit-testable in isolation from the gateway and SDK.
 */
export interface AgentChatOpts {
    baseUrl: string;
    apiKey: string;
    defaultAgentId: string;
}
/**
 * Turn a standalone war-room message into a Paperclip issue assigned to the
 * default agent. The existing issue.created notification path posts the embed,
 * stores the msg→issue mapping, and delivers the agent's reply back to Discord.
 */
export declare function handleAgentChat(ctx: PluginContext, message: MessageCreateEvent, opts: AgentChatOpts): Promise<void>;
export declare function classifyInbound(message: MessageCreateEvent, opts: {
    enableAgentChat: boolean;
    warRoomChannelId: string;
}): InboundKind;
