import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { AzureVoiceLiveProvider } from "../src/voice/providers/azure-voice-live.js";

// We point the provider at a local mock server by passing host=127.0.0.1:port
// and intercepting the URL construction. The provider builds a wss:// URL with
// the endpoint hostname; for tests we override the `endpoint` to include the
// port and use a custom WebSocket dial. The simplest path: use a subclass.

class TestableProvider extends AzureVoiceLiveProvider {}

let mockServer: WebSocketServer | undefined;

interface MockBehavior {
  /** Send session.created on connection. Default: true. */
  sendSessionCreated?: boolean;
  /** Send session.updated after receiving session.update. Default: true. */
  sendSessionUpdated?: boolean;
  /** Transcript text to emit after commit. If null, emit nothing. */
  transcript?: string | null;
  /** Emit an error event after the first append. */
  errorAfterAppend?: { code: string; message: string };
  /** Close mid-session after the commit. */
  closeAfterCommit?: { code: number; reason: string };
}

function makeMockServer(behavior: MockBehavior = {}): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  return new Promise((resolve) => {
    mockServer = new WebSocketServer({ port: 0 }, () => {
      const port = (mockServer!.address() as { port: number }).port;
      resolve({ port, received });
    });
    mockServer.on("connection", (ws: WebSocket) => {
      if (behavior.sendSessionCreated !== false) {
        ws.send(JSON.stringify({ type: "session.created" }));
      }
      let appendCount = 0;
      ws.on("message", (data) => {
        const txt = data.toString();
        received.push(txt);
        let msg: any;
        try {
          msg = JSON.parse(txt);
        } catch {
          return;
        }
        if (msg.type === "session.update" && behavior.sendSessionUpdated !== false) {
          ws.send(JSON.stringify({ type: "session.updated" }));
        }
        if (msg.type === "input_audio_buffer.append") {
          appendCount += 1;
          if (behavior.errorAfterAppend && appendCount === 1) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: {
                  code: behavior.errorAfterAppend.code,
                  message: behavior.errorAfterAppend.message,
                },
              }),
            );
          }
        }
        if (msg.type === "input_audio_buffer.commit") {
          if (behavior.closeAfterCommit) {
            ws.close(behavior.closeAfterCommit.code, behavior.closeAfterCommit.reason);
            return;
          }
          if (behavior.transcript !== null && behavior.transcript !== undefined) {
            // Slight async delay to mimic real server behavior.
            setImmediate(() => {
              ws.send(
                JSON.stringify({
                  type: "conversation.item.input_audio_transcription.completed",
                  transcript: behavior.transcript,
                }),
              );
            });
          }
        }
      });
    });
  });
}

afterEach(() => {
  mockServer?.close();
  mockServer = undefined;
});

// Override the URL the provider connects to by monkey-patching the WS URL via
// a thin extension that lets the test pass a custom endpoint string including
// host:port and intercepts wss://→ws:// for localhost.
function makeProvider(port: number): TestableProvider {
  // We use the public endpoint config but rely on the fact that the provider
  // constructs `wss://${endpoint}/voice-live/realtime…`. By passing the host
  // with port AND patching globalThis.WebSocket if needed... actually the
  // provider imports `ws` directly. The cleanest hook is to make a subclass
  // that overrides openSocket. But that exposes internals.
  //
  // Pragmatic alternative: stub the WebSocket constructor at module level via
  // vitest mock. We instead use the dirty path: override the connect URL by
  // intercepting wss:// → ws:// via vi mock of "ws".
  return new TestableProvider({
    endpoint: `127.0.0.1:${port}`,
    apiKey: "test-key",
    apiVersion: "test-version",
    model: "test-model",
    transcribeTimeoutMs: 2000,
  });
}

// Replace the `ws` module's WebSocket so that wss://127.0.0.1:PORT/... routes
// to a plain ws:// connection. This keeps the provider code untouched.
vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  class PatchedWebSocket extends actual.WebSocket {
    constructor(url: string, options?: any) {
      const patched = url.replace(/^wss:\/\//, "ws://");
      super(patched, options);
    }
  }
  return {
    ...actual,
    WebSocket: PatchedWebSocket,
    default: PatchedWebSocket,
  };
});

const CTX = { userId: "u1", durationSec: 0.2 };

describe("AzureVoiceLiveProvider", () => {
  it("sends BYOM session.update on connect and awaits session.updated", async () => {
    const { port, received } = await makeMockServer({ transcript: "hi" });
    const provider = makeProvider(port);
    await provider.startSession();

    const text = await provider.transcribeUtterance(Buffer.from([0, 0, 0, 0]), CTX);
    expect(text).toBe("hi");

    const sessionUpdate = received.map((r) => JSON.parse(r)).find((m) => m.type === "session.update");
    expect(sessionUpdate).toMatchObject({
      type: "session.update",
      session: {
        modalities: ["text"],
        turn_detection: null,
        input_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
      },
    });
    await provider.stopSession();
  });

  it("never sends response.create (BYOM suppression)", async () => {
    const { port, received } = await makeMockServer({ transcript: "ok" });
    const provider = makeProvider(port);
    await provider.startSession();
    await provider.transcribeUtterance(Buffer.from([0, 0, 0, 0]), CTX);
    const responseCreates = received
      .map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      })
      .filter((m) => m?.type === "response.create");
    expect(responseCreates).toHaveLength(0);
    await provider.stopSession();
  });

  it("rejects when server emits error mid-utterance", async () => {
    const { port } = await makeMockServer({
      errorAfterAppend: { code: "bad", message: "boom" },
      transcript: null,
    });
    const provider = makeProvider(port);
    await provider.startSession();
    await expect(
      provider.transcribeUtterance(Buffer.from([0, 0, 0, 0]), CTX),
    ).rejects.toThrow(/boom/);
    await provider.stopSession();
  });

  it("times out if no transcript arrives", async () => {
    const { port } = await makeMockServer({ transcript: null });
    const provider = makeProvider(port);
    await provider.startSession();
    await expect(
      provider.transcribeUtterance(Buffer.from([0, 0, 0, 0]), CTX),
    ).rejects.toThrow(/timed out/i);
    await provider.stopSession();
  });

  it("serializes concurrent calls", async () => {
    const { port } = await makeMockServer({ transcript: "x" });
    const provider = makeProvider(port);
    await provider.startSession();
    const [a, b] = await Promise.all([
      provider.transcribeUtterance(Buffer.from([0, 0]), CTX),
      provider.transcribeUtterance(Buffer.from([0, 0]), CTX),
    ]);
    expect(a).toBe("x");
    expect(b).toBe("x");
    await provider.stopSession();
  });
});
