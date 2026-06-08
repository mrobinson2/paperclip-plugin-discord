# Discord agent chat in `#war-room` — design (MVP)

**Date:** 2026-06-07
**Status:** Approved design, pre-implementation
**Repo:** `paperclip-plugin-discord` (branch `feat/voice-provider-abstraction`)

## Problem

Posting a standalone message in the Discord `#war-room` channel (e.g. `@Alfred - are you there?`) produces no response. Outbound notifications (issue created, run started/finished) post correctly.

Root cause (verified, not assumed):

- The live inbound handler `handleMessageCreate` (`src/worker.ts:428`) only acts on a message that is a **reply** to a bot-posted issue/escalation notification (`if (!message.message_reference?.message_id) return;` at line 433). It routes that reply's text into a comment on the linked issue. Standalone messages return at line 433 **before any logging**.
- A conversational router exists — `routeMessageToAgent` / `parseAgentMention` in `src/session-registry.ts` — but it is an **orphaned import**: referenced only at `src/worker.ts:36`, never called anywhere in `src` or the deployed `dist` (0 references). It has never executed in production.
- This is **not** a regression from the voice refactor, and **not** an intents/portal/gateway issue. All of those were verified healthy: Discord `MESSAGE CONTENT` privileged intent is ON, the bot can read `#war-room` (REST `GET /channels/<id>/messages` returns 200), and the gateway IDENTIFY/dispatch wiring in `src/gateway.ts` is correct. The conversational path was simply never wired in.

## Goal

Let a user talk to an agent by posting in `#war-room`, and get the agent's response back in `#war-room`, using only proven plumbing.

**Success criteria (verifiable):** Post `are you there?` as a standalone message in `#war-room` → a new PaperClip issue is created assigned to the default agent (Alfred) → the agent's reply appears in `#war-room` → replying to that notification adds a comment and continues the thread. The full loop passing = done.

## Scope

**In scope (MVP):**

- Standalone (non-reply), non-bot messages in the configured `#war-room` channel create a PaperClip issue assigned to a configured default agent.
- Behavior gated behind a feature flag so the redeploy is inert until enabled.

**Out of scope (deferred to a possible Phase 2):**

- Live-session routing via `routeMessageToAgent` (untested code; defer until the issue-backed loop is proven and only if issue latency feels too heavy).
- `@agentname` mention override to target non-default agents.
- Any change to the existing reply-to-comment path or other channels.

## Key insight

When the plugin posts an "Issue Created" notification to Discord, it **already** stores the msg→issue mapping (`src/worker.ts:737`, state key `msg_<channelId>_<messageId>`). The existing reply handler (`handleMessageCreate`) and the `agent.run.finished` / `issue.updated` notification (which includes the issue's `lastComment`, `src/worker.ts:228-247`) already handle continuation and response delivery.

Therefore the only **new** behavior required is: *standalone war-room message → create an issue.* Everything downstream is existing, verified plumbing.

## Architecture

### Dispatcher (small change at `src/worker.ts:575`)

The gateway `onMessage` currently passes `handleMessageCreate` directly. Replace with a thin dispatcher; `handleMessageCreate` itself is left **unchanged**:

```
onMessage(message):
  if message.author.bot:                                  return        // unchanged guard
  if message.message_reference?.message_id:               handleMessageCreate(message)   // EXISTING reply routing, untouched
  else if enableAgentChat && message.channel_id == warRoomChannelId:
                                                          handleAgentChat(ctx, message, cfg, deps)   // NEW
  else:                                                   return        // unchanged: standalone elsewhere stays ignored
```

This preserves every current behavior: all reply routing still flows to `handleMessageCreate` in every channel, and standalone messages outside `#war-room` remain ignored. The only added path is standalone messages in `#war-room`.

`warRoomChannelId` reuses the existing `defaultChannelId` config; no new channel field.

### New module `src/agent-chat.ts`

`handleAgentChat(ctx, message, cfg, deps)` (~30–50 lines):

1. `text = message.content.trim()`; if empty, return.
2. Resolve `companyId` from the plugin's existing channel→company routing config (the same mapping that decides which company a channel's outbound notifications belong to). A standalone message has no stored msg→issue mapping to read it from, so it comes from channel config, not from a mapping.
3. `agentId = cfg.defaultAgentId`. If absent or not found in `ctx.agents.list({companyId})`, log and return (a short "no agent configured" reply is acceptable but optional).
4. Create the issue:
   ```
   POST {baseUrl}/api/issues
   { title: <first line of text, truncated to 80 chars>, body: text,
     assigneeAgentId: agentId, authorUserId: `discord:${message.author.username}` }
   ```
   via the existing `paperclipFetch` helper with `paperclipBoardApiKey`.
5. Return. The `issue.created` event fires the existing notification → which posts the embed to `#war-room` and stores the msg→issue mapping → enabling reply continuation, with no additional code.

No new outbound posting, mapping, or continuation logic is written; those already exist.

### Configuration (`src/manifest.ts`)

Two new fields:

- `enableAgentChat` — boolean, default `false`. Safe-deploy flag; behavior is inert until set true.
- `defaultAgentId` — string. The agent assigned to issues created from `#war-room` chat (Alfred, `b9cfea80-98d6-4607-8065-63315103caf4`). Stored as config, not hardcoded.

## Data flow

```
user posts "are you there?" in #war-room (standalone)
  → gateway MESSAGE_CREATE → dispatcher → handleAgentChat
     → POST /api/issues (assignee = Alfred, body = "are you there?")
        → issue.created event
           → existing handler posts "Issue Created: MRT-xxx" embed to #war-room
           → existing handler stores msg_<channel>_<embedMsgId> → {issue, company}
  → Alfred runs the issue → comments with its response
     → agent.run.finished / issue.updated event
        → existing handler posts notification incl. lastComment (Alfred's reply) to #war-room
  → user replies to the notification
     → handleMessageCreate (existing) finds mapping → POSTs reply as issue comment → continues
```

## Error handling (real cases only)

- `paperclipFetch` issue-create failure → catch, log via `ctx.logger.error`, optionally post a brief "couldn't reach the board" message. Do not throw out of the handler.
- `defaultAgentId` missing or not in `ctx.agents.list` → log and skip.
- Empty/whitespace message → return early.

No handling for impossible scenarios (e.g. malformed gateway payloads the SDK already validates).

## Testing

- **Unit — `handleAgentChat`:** given a standalone message and a configured `defaultAgentId`, asserts `paperclipFetch` is called with the correct issue payload (`assigneeAgentId`, `body`, `authorUserId`). Mocks `ctx`.
- **Unit — dispatcher:** bot message → dropped; reply → routed to `handleMessageCreate`; standalone in war-room (flag on) → routed to `handleAgentChat`; standalone in war-room (flag off) → dropped; standalone in another channel → dropped.
- **Regression:** existing 488 tests still pass unchanged.
- **Manual E2E:** the success-criteria loop above.

## Deploy

1. `tsc` build.
2. Commit built `dist/` to the `feat/voice-provider-abstraction-dist` branch (PaperClip plugin install runs `npm install --ignore-scripts`, so `prepare`/`tsc` does not run on install).
3. Reinstall the plugin via the tarball URL (documented install command).
4. Set `enableAgentChat = true` and `defaultAgentId` in plugin config.
5. Run the E2E success loop to verify.

## Future (Phase 2, only if warranted)

- Wire `routeMessageToAgent` for live-session routing when the target agent already has a running session, falling back to issue creation otherwise.
- `@agentname` override via `parseAgentMention` to address non-default agents.
