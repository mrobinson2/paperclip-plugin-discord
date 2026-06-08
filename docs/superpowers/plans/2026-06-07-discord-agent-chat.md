# Discord Agent Chat (#war-room) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a standalone message in the Discord `#war-room` channel create a PaperClip issue assigned to a default agent, so the agent responds via the existing notification path.

**Architecture:** Add a thin dispatcher at the gateway `onMessage` site that classifies each inbound message (bot → ignore, reply → existing `handleMessageCreate` unchanged, standalone in war-room → new `handleAgentChat`). `handleAgentChat` creates a PaperClip issue; all downstream notification, msg→issue mapping, response delivery, and reply continuation already exist.

**Tech Stack:** TypeScript, vitest, the PaperClip plugin SDK (`@paperclipai/plugin-sdk`), `paperclipFetch` HTTP helper.

**Spec:** `docs/superpowers/specs/2026-06-07-discord-agent-chat-design.md`

---

## File Structure

- **Create** `src/agent-chat.ts` — new unit. Exports `classifyInbound` (pure routing decision) and `handleAgentChat` (creates an issue from a war-room message). One responsibility: turn a standalone war-room message into an assigned issue.
- **Create** `tests/agent-chat.test.ts` — vitest unit tests for both exports.
- **Modify** `src/constants.ts` — add two fields to `DEFAULT_CONFIG`.
- **Modify** `src/worker.ts` — add two fields to the `DiscordConfig` type; replace the `onMessage` argument to `connectGateway` with the dispatcher; add one import line. `handleMessageCreate` itself is left untouched.
- **Modify** `src/manifest.ts` — add two config parameter blocks.

---

## Task 1: Add config fields (type, defaults, manifest)

**Files:**
- Modify: `src/constants.ts` (DEFAULT_CONFIG object, ends ~line 56)
- Modify: `src/worker.ts:90` (DiscordConfig type)
- Modify: `src/manifest.ts:243-250` (parameter blocks)

- [ ] **Step 1: Add defaults to `DEFAULT_CONFIG`**

In `src/constants.ts`, inside the `DEFAULT_CONFIG` object, immediately after the `enableInbound: true,` line, add:

```typescript
  enableAgentChat: false,
  defaultAgentId: "",
```

- [ ] **Step 2: Add fields to the `DiscordConfig` type**

In `src/worker.ts`, in the `DiscordConfig` type (the `enableInbound: boolean;` line is ~line 90), add immediately after it:

```typescript
  enableAgentChat: boolean;
  defaultAgentId: string;
```

- [ ] **Step 3: Add manifest parameter blocks**

In `src/manifest.ts`, immediately after the `enableInbound` parameter block (the one ending with `default: DEFAULT_CONFIG.enableInbound,` and its closing `},`), add:

```typescript
      enableAgentChat: {
        type: "boolean",
        title: "Enable agent chat in war-room",
        description:
          "Treat standalone (non-reply) messages in the default channel as input to the default agent by creating an assigned issue.",
        default: DEFAULT_CONFIG.enableAgentChat,
      },
      defaultAgentId: {
        type: "string",
        title: "Default agent for war-room chat",
        description:
          "Paperclip agent UUID assigned to issues created from standalone war-room messages.",
        default: DEFAULT_CONFIG.defaultAgentId,
      },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/worker.ts src/manifest.ts
git commit -m "feat(agent-chat): add enableAgentChat and defaultAgentId config"
```

---

## Task 2: `classifyInbound` routing decision (TDD)

**Files:**
- Create: `src/agent-chat.ts`
- Test: `tests/agent-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent-chat.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-chat.test.ts`
Expected: FAIL — cannot find module `../src/agent-chat.js` / `classifyInbound is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/agent-chat.ts`:

```typescript
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
  if (message.author?.bot) return "ignore";
  if (message.message_reference?.message_id) return "reply";
  if (opts.enableAgentChat && message.channel_id === opts.warRoomChannelId) {
    return "agentChat";
  }
  return "ignore";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent-chat.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent-chat.ts tests/agent-chat.test.ts
git commit -m "feat(agent-chat): add classifyInbound routing decision"
```

---

## Task 3: `handleAgentChat` issue creation (TDD)

**Files:**
- Modify: `src/agent-chat.ts`
- Test: `tests/agent-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/agent-chat.test.ts`. Add this import at the top of the file (next to the existing import):

```typescript
import { handleAgentChat } from "../src/agent-chat.js";
import { paperclipFetch } from "../src/paperclip-fetch.js";
import { resolveCompanyId } from "../src/company-resolver.js";
import { vi, beforeEach } from "vitest";

vi.mock("../src/paperclip-fetch.js", () => ({
  paperclipFetch: vi.fn(),
}));
vi.mock("../src/company-resolver.js", () => ({
  resolveCompanyId: vi.fn(),
}));
```

Then add this describe block:

```typescript
const COMPANY = "f75ce74d-b1cd-4a64-9f99-9d26b0539d71";
const AGENT = "b9cfea80-98d6-4607-8065-63315103caf4";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    agents: {
      list: vi.fn().mockResolvedValue([{ id: AGENT, name: "Alfred" }]),
    },
    ...overrides,
  } as any;
}

const OPTS = { baseUrl: "https://api.test", apiKey: "key-123", defaultAgentId: AGENT };

describe("handleAgentChat", () => {
  beforeEach(() => {
    vi.mocked(resolveCompanyId).mockResolvedValue(COMPANY);
    vi.mocked(paperclipFetch).mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: "issue-1" }) } as any);
  });

  it("creates an issue assigned to the default agent", async () => {
    const ctx = makeCtx();
    await handleAgentChat(ctx, msg({ content: "are you there?" }), OPTS);

    expect(paperclipFetch).toHaveBeenCalledTimes(1);
    const [url, init, apiKey] = vi.mocked(paperclipFetch).mock.calls[0]!;
    expect(url).toBe(`https://api.test/api/companies/${COMPANY}/issues`);
    expect(apiKey).toBe("key-123");
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({
      title: "are you there?",
      description: "are you there?",
      status: "todo",
      assigneeAgentId: AGENT,
    });
  });

  it("ignores empty messages", async () => {
    await handleAgentChat(makeCtx(), msg({ content: "   " }), OPTS);
    expect(paperclipFetch).not.toHaveBeenCalled();
  });

  it("skips when the configured agent is not found for the company", async () => {
    const ctx = makeCtx({ agents: { list: vi.fn().mockResolvedValue([{ id: "other", name: "Bob" }]) } });
    await handleAgentChat(ctx, msg({ content: "hi" }), OPTS);
    expect(paperclipFetch).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("logs an error when issue creation returns non-ok", async () => {
    vi.mocked(paperclipFetch).mockResolvedValue({ ok: false, status: 500 } as any);
    const ctx = makeCtx();
    await handleAgentChat(ctx, msg({ content: "hi" }), OPTS);
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-chat.test.ts`
Expected: FAIL — `handleAgentChat is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/agent-chat.ts`, add these imports at the top (below the existing `MessageCreateEvent` import):

```typescript
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { paperclipFetch } from "./paperclip-fetch.js";
import { resolveCompanyId } from "./company-resolver.js";
```

Then append:

```typescript
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
    return;
  }

  const title = text.split("\n")[0]!.slice(0, 80);

  try {
    const resp = await paperclipFetch(
      `${opts.baseUrl}/api/companies/${companyId}/issues`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: text,
          status: "todo",
          assigneeAgentId: opts.defaultAgentId,
        }),
      },
      opts.apiKey,
    );

    if (!resp.ok) {
      ctx.logger.error("agent-chat: issue create failed", { status: resp.status });
      return;
    }

    ctx.logger.info("agent-chat: created issue from Discord message", {
      from: message.author.username,
      companyId,
      assigneeAgentId: opts.defaultAgentId,
    });
  } catch (err) {
    ctx.logger.error("agent-chat: issue create error", { error: String(err) });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent-chat.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/agent-chat.ts tests/agent-chat.test.ts
git commit -m "feat(agent-chat): create assigned issue from war-room message"
```

---

## Task 4: Wire the dispatcher into the gateway

**Files:**
- Modify: `src/worker.ts:33` (add import), `src/worker.ts:569-575` (connectGateway `onMessage` argument)

- [ ] **Step 1: Add the import**

In `src/worker.ts`, immediately after the existing `import { connectGateway, type MessageCreateEvent } from "./gateway.js";` line, add:

```typescript
import { classifyInbound, handleAgentChat } from "./agent-chat.js";
```

- [ ] **Step 2: Replace the `onMessage` argument to `connectGateway`**

In `src/worker.ts`, in the `connectGateway(...)` call, replace this argument line:

```typescript
      gatewayNeedsMessages ? handleMessageCreate : undefined,
```

with:

```typescript
      gatewayNeedsMessages
        ? async (message: MessageCreateEvent) => {
            const kind = classifyInbound(message, {
              enableAgentChat: config.enableAgentChat,
              warRoomChannelId: normalizeDiscordId(config.defaultChannelId) ?? "",
            });
            if (kind === "reply") {
              await handleMessageCreate(message);
            } else if (kind === "agentChat") {
              await handleAgentChat(ctx, message, {
                baseUrl,
                apiKey: paperclipBoardApiKey,
                defaultAgentId: config.defaultAgentId,
              });
            }
          }
        : undefined,
```

Note: `normalizeDiscordId`, `baseUrl`, `paperclipBoardApiKey`, `config`, and `ctx` are already in scope at this call site (the same closure `handleMessageCreate` lives in, which uses `baseUrl` and `paperclipBoardApiKey` at lines 491-501).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `normalizeDiscordId` is reported unused-before or out of scope, confirm it is imported in `src/worker.ts` (it is used at line 386); no new import needed.

- [ ] **Step 4: Run the full test suite (regression + new)**

Run: `npx vitest run`
Expected: PASS — the existing suite (~488) plus the 9 new `agent-chat` tests, with zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts
git commit -m "feat(agent-chat): dispatch standalone war-room messages to agent chat"
```

---

## Task 5: Build, deploy, and verify end-to-end

This task is operational (no unit tests). It builds the `dist`, deploys to `ca-paperclip-dev`, enables the flag, and runs the success-criteria loop.

**Files:**
- Build artifact: `dist/` (committed to the `feat/voice-provider-abstraction-dist` branch)

- [ ] **Step 1: Build the dist**

Run: `npm run build`
Expected: `tsc` completes with no errors; `dist/worker.js`, `dist/agent-chat.js` updated.

- [ ] **Step 2: Sync built `dist/` to the dist branch and push**

PaperClip installs from the `-dist` branch because plugin install runs `npm install --ignore-scripts` (no `prepare`/`tsc`). Sync the freshly built `dist/` onto that branch:

```bash
git push origin feat/voice-provider-abstraction
git checkout feat/voice-provider-abstraction-dist
git checkout feat/voice-provider-abstraction -- src
npm run build
git add dist src
git commit -m "chore(dist): build agent-chat into deployed dist"
git push origin feat/voice-provider-abstraction-dist
git checkout feat/voice-provider-abstraction
```

- [ ] **Step 3: Mint an automation JWT**

```bash
SECRET=$(az keyvault secret show --vault-name mrt-vault-dev-kv \
  --name platform-paperclip-automation-jwt-secret --query value -o tsv)
TOKEN=$(python3 -c "
import hmac, hashlib, base64, json, time
secret = '''$SECRET'''
now = int(time.time())
payload = {'sub':'automation','iss':'mrtek-mission-control','aud':'paperclip-api',
           'role':'admin','scope':['plugins:read','plugins:write'],'iat':now,'exp':now+600}
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
h=b64(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
p=b64(json.dumps(payload,separators=(',',':')).encode())
sig=b64(hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())
print(f'{h}.{p}.{sig}')
")
echo "JWT minted (len ${#TOKEN})"
```

- [ ] **Step 4: Reinstall the plugin from the dist branch**

```bash
PLUGIN_ID="f12b5bb9-5497-412b-8e14-a9b112a92239"
curl -sS -X DELETE "https://mission-control-dev.mrtek.ai/api/plugins/$PLUGIN_ID" \
  -H "Authorization: Bearer $TOKEN"
curl -sS -X POST "https://mission-control-dev.mrtek.ai/api/plugins/install" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"packageName":"paperclip-plugin-discord","version":"https://codeload.github.com/mrobinson2/paperclip-plugin-discord/tar.gz/refs/heads/feat/voice-provider-abstraction-dist"}'
```

Expected: install responds with a plugin record; status becomes `ready`.

- [ ] **Step 5: Enable the feature and set the default agent**

```bash
PLUGIN_ID="f12b5bb9-5497-412b-8e14-a9b112a92239"
curl -sS -X POST "https://mission-control-dev.mrtek.ai/api/plugins/$PLUGIN_ID/config" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"configJson":{
    "defaultChannelId":"1502099355975422082",
    "defaultGuildId":"1500643502407815248",
    "enableInbound":true,
    "enableCommands":true,
    "enableAgentChat":true,
    "defaultAgentId":"b9cfea80-98d6-4607-8065-63315103caf4"
  }}'
```

Expected: config accepted (200). (Merge with the live config first if other fields are set — `GET /api/plugins/$PLUGIN_ID` to read current config.)

- [ ] **Step 6: End-to-end verification (success criteria)**

In Discord `#war-room`, post a **standalone** message (not a reply): `are you there?`

Verify, in order:
1. A new issue appears assigned to Alfred — check `GET /api/companies/f75ce74d-b1cd-4a64-9f99-9d26b0539d71/issues?assigneeAgentId=b9cfea80-98d6-4607-8065-63315103caf4&limit=5` (newest should be titled `are you there?`).
2. An "Issue Created" embed posts to `#war-room`.
3. When Alfred finishes, its reply appears in `#war-room` (run-finished notification with the last comment).
4. **Reply** to that notification with a follow-up → it lands as a comment on the issue (existing path).

If all four pass, the MVP is complete. If step 1 fails, check container logs (`az containerapp logs show -n ca-paperclip-dev -g mrt-vault-dev-rg --tail 100`) for `agent-chat:` log lines.

---

## Self-Review

**Spec coverage:**
- Standalone war-room message → issue → Task 3 (`handleAgentChat`) + Task 4 (dispatch). ✓
- Existing reply path unchanged → Task 4 routes `reply` to untouched `handleMessageCreate`. ✓
- Feature flag (off by default) + `defaultAgentId` → Task 1. ✓
- Response delivery / continuation via existing plumbing → Task 5 Step 6 verifies; no new code (by design). ✓
- Error handling (issue-create failure, missing agent, empty message) → Task 3 tests + implementation. ✓
- Live-session routing & @mention override → explicitly out of scope (spec Phase 2); no task, intentional. ✓

**Type consistency:** `classifyInbound`/`handleAgentChat`/`AgentChatOpts`/`InboundKind` names match across Tasks 2, 3, 4. Issue payload fields (`title`, `description`, `status`, `assigneeAgentId`) match the real endpoint (`execCreateIssue`, `src/workflow-engine.ts:243-251`). Config field names (`enableAgentChat`, `defaultAgentId`) consistent across constants/type/manifest/dispatcher.

**Placeholder scan:** No TBD/TODO; all code blocks complete; commands have expected output.
