import type { MessageCreateEvent } from "./gateway.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { resolveCompanyId } from "./company-resolver.js";

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
export async function handleAgentChat(
  ctx: PluginContext,
  message: MessageCreateEvent,
  opts: AgentChatOpts,
): Promise<void> {
  const text = message.content?.trim();
  if (!text) return;

  if (!opts.defaultAgentId) {
    ctx.logger.warn("agent-chat: no defaultAgentId configured; ignoring message");
    return;
  }

  const companyId = await resolveCompanyId(ctx);

  const agents = (await ctx.agents.list({ companyId })) as Array<{ id: string; name: string }>;
  if (!agents.some((a) => a.id === opts.defaultAgentId)) {
    ctx.logger.warn("agent-chat: defaultAgentId not found for company; ignoring", {
      defaultAgentId: opts.defaultAgentId,
      companyId,
    });
    ctx.metrics.write("discord_agentchat_created", 2).catch(() => {});
    return;
  }

  const title = text.split("\n")[0]!.slice(0, 80);

  // Create via the SDK's host-authenticated issues client (like ctx.issues.get
  // used elsewhere) rather than raw HTTP — avoids needing a board API key, which
  // the plugin config does not carry, and which made the raw POST return 401.
  try {
    const issue = await ctx.issues.create({
      companyId,
      title,
      description: text,
      assigneeAgentId: opts.defaultAgentId,
    });
    // ctx.issues.create has no status param and defaults to "backlog" — which
    // never starts when the assignee is mid-run. Force "todo" so it queues and
    // runs regardless of the agent's current state.
    const issueId = (issue as { id?: string } | null)?.id;
    if (issueId) {
      await ctx.issues.update(issueId, { status: "todo" }, companyId);
    }
    ctx.logger.info("agent-chat: created issue from Discord message", {
      issueId,
      from: message.author.username,
      companyId,
      assigneeAgentId: opts.defaultAgentId,
    });
    ctx.metrics.write("discord_agentchat_created", 1).catch(() => {});
  } catch (err) {
    ctx.logger.error("agent-chat: issue create error", { error: String(err) });
    ctx.metrics.write("discord_agentchat_created", 4).catch(() => {});
  }
}

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
