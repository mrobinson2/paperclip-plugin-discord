import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { DeepgramProvider } from "../src/voice/providers/deepgram.js";

let mockServer: WebSocketServer | undefined;

function makeServer(handler: (ws: WebSocket) => void): Promise<number> {
  return new Promise((resolve) => {
    mockServer = new WebSocketServer({ port: 0 }, () => {
      const port = (mockServer!.address() as { port: number }).port;
      resolve(port);
    });
    mockServer.on("connection", handler);
  });
}

afterEach(() => {
  mockServer?.close();
  mockServer = undefined;
});

const CTX = { userId: "u1", durationSec: 1 };

describe("DeepgramProvider", () => {
  it("sends PCM then Finalize and resolves with final transcript", async () => {
    let receivedBinary = false;
    let receivedFinalize = false;
    const port = await makeServer((ws) => {
      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          receivedBinary = true;
        } else {
          const msg = JSON.parse(data.toString());
          if (msg.type === "Finalize") {
            receivedFinalize = true;
            ws.send(
              JSON.stringify({
                type: "Results",
                is_final: true,
                channel: { alternatives: [{ transcript: "hello world" }] },
              }),
            );
          }
        }
      });
    });

    const provider = new DeepgramProvider({
      apiKey: "test-key",
      baseUrl: `ws://localhost:${port}`,
    });
    const transcript = await provider.transcribeUtterance(
      Buffer.from([1, 2, 3, 4]),
      CTX,
    );

    expect(receivedBinary).toBe(true);
    expect(receivedFinalize).toBe(true);
    expect(transcript).toBe("hello world");
  });

  it("rejects on WS close without a final result", async () => {
    const port = await makeServer((ws) => {
      ws.on("message", () => {
        ws.close();
      });
    });

    const provider = new DeepgramProvider({
      apiKey: "test-key",
      baseUrl: `ws://localhost:${port}`,
    });

    await expect(
      provider.transcribeUtterance(Buffer.from([1, 2, 3, 4]), CTX),
    ).rejects.toThrow(/no final transcript/i);
  });

  it("rejects on WS auth-failure close", async () => {
    const port = await makeServer((ws) => {
      // simulate Deepgram-style auth-failure close
      ws.close(4001, "unauthorized");
    });

    const provider = new DeepgramProvider({
      apiKey: "bad-key",
      baseUrl: `ws://localhost:${port}`,
    });

    await expect(
      provider.transcribeUtterance(Buffer.from([1, 2, 3, 4]), CTX),
    ).rejects.toThrow();
  });

  it("returns empty string when transcript is empty (silence)", async () => {
    const port = await makeServer((ws) => {
      ws.on("message", (_data, isBinary) => {
        if (!isBinary) {
          ws.send(
            JSON.stringify({
              type: "Results",
              is_final: true,
              channel: { alternatives: [{ transcript: "" }] },
            }),
          );
        }
      });
    });

    const provider = new DeepgramProvider({
      apiKey: "test-key",
      baseUrl: `ws://localhost:${port}`,
    });
    const transcript = await provider.transcribeUtterance(
      Buffer.from([1, 2, 3, 4]),
      CTX,
    );
    expect(transcript).toBe("");
  });

  it("startSession + stopSession are no-ops", async () => {
    const provider = new DeepgramProvider({ apiKey: "k" });
    await expect(provider.startSession()).resolves.toBeUndefined();
    await expect(provider.stopSession()).resolves.toBeUndefined();
    expect(provider.name).toBe("deepgram");
  });
});
