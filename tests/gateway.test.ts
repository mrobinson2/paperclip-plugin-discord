import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";

function makeCtx(): PluginContext {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    http: {
      fetch: vi.fn(),
    },
    metrics: { emit: vi.fn() },
  } as unknown as PluginContext;
}

describe("connectGateway", () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("returns no-op and warns when WebSocket is not available", async () => {
    // Simulate an environment without WebSocket (Node < 21)
    // @ts-expect-error -- intentionally deleting global for test
    delete globalThis.WebSocket;

    const { connectGateway } = await import("../src/gateway.js");
    const ctx = makeCtx();
    const handler = vi.fn();

    const result = await connectGateway(ctx, "fake-token", handler);

    expect(result).toEqual({ close: expect.any(Function) });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("WebSocket is not available"),
    );
    expect(handler).not.toHaveBeenCalled();
    result.close(); // should not throw
  });

  it("uses guild-only intents when message subscriptions are disabled", async () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      sent: string[] = [];

      constructor(_url: string) {
        FakeWebSocket.instances.push(this);
      }

      send(payload: string) {
        this.sent.push(payload);
      }

      close() {}
    }

    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const { connectGateway } = await import("../src/gateway.js");
    const ctx = makeCtx();
    (ctx.http.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: "wss://gateway.discord.test" }),
    });

    const result = await connectGateway(ctx, "fake-token", vi.fn(), undefined, {
      listenForMessages: false,
      includeMessageContent: false,
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    socket.onmessage?.({
      data: JSON.stringify({
        op: 10,
        d: { heartbeat_interval: 10000 },
        s: null,
        t: null,
      }),
    });

    const identify = JSON.parse(socket.sent[0] ?? "{}");
    expect(identify.op).toBe(2);
    expect(identify.d.intents).toBe(1);

    result.close();
  });

  describe("voice readiness gate (regression: join-before-ready race)", () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      static OPEN = 1;
      readyState = 1; // OPEN
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      sent: string[] = [];

      constructor(_url: string) {
        FakeWebSocket.instances.push(this);
      }
      send(payload: string) {
        this.sent.push(payload);
      }
      close() {}
    }

    async function connectVoiceGateway() {
      FakeWebSocket.instances = [];
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
      const { connectGateway } = await import("../src/gateway.js");
      const ctx = makeCtx();
      (ctx as unknown as { metrics: { write: ReturnType<typeof vi.fn> } }).metrics = {
        write: vi.fn().mockResolvedValue(undefined),
      };
      (ctx.http.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ url: "wss://gateway.discord.test" }),
      });
      const handle = await connectGateway(ctx, "fake-token", vi.fn(), undefined, {
        enableVoice: true,
      });
      const socket = FakeWebSocket.instances[0]!;
      // op 10 HELLO -> triggers IDENTIFY
      socket.onmessage?.({
        data: JSON.stringify({ op: 10, d: { heartbeat_interval: 10000 }, s: null, t: null }),
      });
      return { handle, socket };
    }

    function sendReady(socket: FakeWebSocket) {
      socket.onmessage?.({
        data: JSON.stringify({
          op: 0,
          t: "READY",
          s: 1,
          d: { session_id: "sess-1", resume_gateway_url: "wss://resume.test" },
        }),
      });
    }

    it("exposes whenReady() on the voice handle when enableVoice is set", async () => {
      const { handle } = await connectVoiceGateway();
      expect(handle.voice).toBeDefined();
      expect(typeof handle.voice!.whenReady).toBe("function");
      handle.close();
    });

    it("whenReady() does NOT resolve before READY arrives", async () => {
      const { handle } = await connectVoiceGateway();
      let resolved = false;
      handle.voice!
        .whenReady()
        .then(() => {
          resolved = true;
        })
        // close() at the end of the test rejects the promise; swallow so it
        // doesn't surface as an unhandled rejection in the runner.
        .catch(() => {});
      // Let microtasks flush; READY has not been sent yet.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(resolved).toBe(false);
      handle.close();
    });

    it("whenReady() resolves once READY is received (op-4 can now be delivered)", async () => {
      const { handle, socket } = await connectVoiceGateway();
      const readyP = handle.voice!.whenReady();
      sendReady(socket);
      await expect(readyP).resolves.toBeUndefined();
      handle.close();
    });

    it("whenReady() rejects if the gateway is closed before READY", async () => {
      const { handle } = await connectVoiceGateway();
      const readyP = handle.voice!.whenReady();
      handle.close();
      await expect(readyP).rejects.toThrow(/ready/i);
    });

    it("treats close 4014 (disallowed intent) as fatal: whenReady rejects, no reconnect", async () => {
      const { handle, socket } = await connectVoiceGateway();
      const readyP = handle.voice!.whenReady();
      const before = FakeWebSocket.instances.length;
      socket.onclose?.({ code: 4014, reason: "Disallowed intent" });
      await expect(readyP).rejects.toThrow(/non-recoverable|4014/i);
      // A fatal close does not schedule a reconnect, so no new socket appears.
      expect(FakeWebSocket.instances.length).toBe(before);
    });
  });
});

describe("respondViaCallback", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("handles 204 responses without error (Bug 1 regression)", async () => {
    // Simulate Discord returning 204 No Content on successful callback
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    }) as unknown as typeof fetch;

    const { respondViaCallback } = await import("../src/gateway.js");
    const ctx = makeCtx();

    await respondViaCallback(ctx, "interaction-1", "token-1", {
      type: 4,
      data: { content: "Hello" },
    });

    // Should not log any error or warning
    expect(ctx.logger.error).not.toHaveBeenCalled();
    expect(ctx.logger.warn).not.toHaveBeenCalled();

    // Should have called native fetch, not ctx.http.fetch
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/interactions/interaction-1/token-1/callback"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(ctx.http.fetch).not.toHaveBeenCalled();
  });

  it("logs warning on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    }) as unknown as typeof fetch;

    const { respondViaCallback } = await import("../src/gateway.js");
    const ctx = makeCtx();

    await respondViaCallback(ctx, "interaction-1", "token-1", { type: 4 });

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "Interaction callback failed",
      expect.objectContaining({ status: 400 }),
    );
  });
});
