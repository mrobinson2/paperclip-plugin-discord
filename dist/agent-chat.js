import { paperclipFetch } from "./paperclip-fetch.js";
import { resolveCompanyId } from "./company-resolver.js";
/**
 * Turn a standalone war-room message into a Paperclip issue assigned to the
 * default agent. The existing issue.created notification path posts the embed,
 * stores the msg→issue mapping, and delivers the agent's reply back to Discord.
 */
export async function handleAgentChat(ctx, message, opts) {
    const text = message.content?.trim();
    if (!text)
        return;
    if (!opts.defaultAgentId) {
        ctx.logger.warn("agent-chat: no defaultAgentId configured; ignoring message");
        return;
    }
    const companyId = await resolveCompanyId(ctx);
    const agents = (await ctx.agents.list({ companyId }));
    if (!agents.some((a) => a.id === opts.defaultAgentId)) {
        ctx.logger.warn("agent-chat: defaultAgentId not found for company; ignoring", {
            defaultAgentId: opts.defaultAgentId,
            companyId,
        });
        return;
    }
    const title = text.split("\n")[0].slice(0, 80);
    try {
        const resp = await paperclipFetch(`${opts.baseUrl}/api/companies/${companyId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title,
                description: text,
                status: "todo",
                assigneeAgentId: opts.defaultAgentId,
            }),
        }, opts.apiKey);
        if (!resp.ok) {
            ctx.logger.error("agent-chat: issue create failed", { status: resp.status });
            return;
        }
        ctx.logger.info("agent-chat: created issue from Discord message", {
            from: message.author.username,
            companyId,
            assigneeAgentId: opts.defaultAgentId,
        });
    }
    catch (err) {
        ctx.logger.error("agent-chat: issue create error", { error: String(err) });
    }
}
export function classifyInbound(message, opts) {
    if (message.author.bot)
        return "ignore";
    if (message.message_reference?.message_id)
        return "reply";
    if (opts.enableAgentChat && message.channel_id === opts.warRoomChannelId) {
        return "agentChat";
    }
    return "ignore";
}
//# sourceMappingURL=agent-chat.js.map