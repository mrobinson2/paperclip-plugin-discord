import { type PluginContext, type PluginEvent } from "@paperclipai/plugin-sdk";
type IssueNotificationPayload = Record<string, unknown>;
/**
 * Run lifecycle payloads (agent.run.started/finished/failed) carry only UUIDs
 * from core — agentId and (via contextSnapshot) issueId. Resolve the human
 * labels the formatters already look for (agentName, issueIdentifier,
 * issueTitle) so embeds read "Run Started: Alfred — Task: MRT-387 …" instead
 * of "Run Started: Agent". Fail-soft: any lookup error returns what we have
 * so the notification still posts.
 */
export declare function enrichRunEventPayload(ctx: PluginContext, event: PluginEvent): Promise<IssueNotificationPayload>;
export {};
