import { describe, it, expect, vi } from "vitest";
import {
  buildPrimaryProvider,
  buildFallbackProvider,
  startWithFallback,
} from "../src/voice/providers/index.js";
import { AzureVoiceLiveProvider } from "../src/voice/providers/azure-voice-live.js";
import { DeepgramProvider } from "../src/voice/providers/deepgram.js";
import type { VoiceProvider } from "../src/voice/types.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("buildPrimaryProvider", () => {
  it("defaults to azure_voice_live when VOICE_PROVIDER unset", () => {
    const p = buildPrimaryProvider({
      AZURE_VOICE_LIVE_ENDPOINT: "host",
      AZURE_VOICE_LIVE_API_KEY: "k",
    });
    expect(p).toBeInstanceOf(AzureVoiceLiveProvider);
    expect(p.name).toBe("azure_voice_live");
  });

  it("respects VOICE_PROVIDER=deepgram", () => {
    const p = buildPrimaryProvider({
      VOICE_PROVIDER: "deepgram",
      DEEPGRAM_API_KEY: "k",
    });
    expect(p).toBeInstanceOf(DeepgramProvider);
    expect(p.name).toBe("deepgram");
  });

  it("VOICE_PROVIDER comparison is case-insensitive", () => {
    const p = buildPrimaryProvider({
      VOICE_PROVIDER: "DEEPGRAM",
      DEEPGRAM_API_KEY: "k",
    });
    expect(p.name).toBe("deepgram");
  });

  it("throws if Azure Voice Live env is missing", () => {
    expect(() =>
      buildPrimaryProvider({
        VOICE_PROVIDER: "azure_voice_live",
        AZURE_VOICE_LIVE_ENDPOINT: "host",
        // missing key
      }),
    ).toThrow(/AZURE_VOICE_LIVE_API_KEY/);
  });

  it("throws if Deepgram env is missing", () => {
    expect(() =>
      buildPrimaryProvider({ VOICE_PROVIDER: "deepgram" }),
    ).toThrow(/DEEPGRAM_API_KEY/);
  });

  it("throws on unknown VOICE_PROVIDER", () => {
    expect(() =>
      buildPrimaryProvider({ VOICE_PROVIDER: "whisper-local" }),
    ).toThrow(/Unknown VOICE_PROVIDER/);
  });
});

describe("buildFallbackProvider", () => {
  it("returns null when fallback flag is unset", () => {
    expect(buildFallbackProvider({ DEEPGRAM_API_KEY: "k" })).toBeNull();
  });

  it("returns null when fallback enabled but DEEPGRAM_API_KEY missing", () => {
    expect(
      buildFallbackProvider({ VOICE_ENABLE_DEEPGRAM_FALLBACK: "true" }),
    ).toBeNull();
  });

  it("returns Deepgram provider when fallback enabled + key present", () => {
    const p = buildFallbackProvider({
      VOICE_ENABLE_DEEPGRAM_FALLBACK: "true",
      DEEPGRAM_API_KEY: "k",
    });
    expect(p).toBeInstanceOf(DeepgramProvider);
  });

  it("fallback flag is case-insensitive", () => {
    const p = buildFallbackProvider({
      VOICE_ENABLE_DEEPGRAM_FALLBACK: "TRUE",
      DEEPGRAM_API_KEY: "k",
    });
    expect(p).not.toBeNull();
  });
});

describe("startWithFallback", () => {
  function fakeProvider(name: string, startFails = false): VoiceProvider {
    return {
      name,
      startSession: vi.fn(async () => {
        if (startFails) throw new Error(`${name} init failed`);
      }),
      stopSession: vi.fn(async () => {}),
      transcribeUtterance: vi.fn(async () => ""),
    };
  }

  it("uses primary when primary starts cleanly", async () => {
    const primary = fakeProvider("azure_voice_live");
    const fallback = fakeProvider("deepgram");
    const active = await startWithFallback(primary, fallback, noopLogger);
    expect(active).toBe(primary);
    expect(primary.startSession).toHaveBeenCalledOnce();
    expect(fallback.startSession).not.toHaveBeenCalled();
  });

  it("falls back when primary throws and fallback exists", async () => {
    const primary = fakeProvider("azure_voice_live", true);
    const fallback = fakeProvider("deepgram");
    const active = await startWithFallback(primary, fallback, noopLogger);
    expect(active).toBe(fallback);
    expect(fallback.startSession).toHaveBeenCalledOnce();
  });

  it("rethrows when primary fails and no fallback", async () => {
    const primary = fakeProvider("azure_voice_live", true);
    await expect(startWithFallback(primary, null, noopLogger)).rejects.toThrow(
      /azure_voice_live init failed/,
    );
  });
});
