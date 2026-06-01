import { describe, it, expect } from "vitest";
import { resample48kTo24k } from "../src/voice/audio/resample.js";

describe("resample48kTo24k", () => {
  it("outputs half as many samples as input", () => {
    // 48000 samples of 48kHz mono = 1s = 96000 bytes
    const input = Buffer.alloc(96000);
    const out = resample48kTo24k(input);
    expect(out.length).toBe(48000); // 24000 samples × 2 bytes
  });

  it("rounds down for odd sample counts", () => {
    // 7 input samples = 14 bytes → 3 output samples = 6 bytes
    const input = Buffer.alloc(14);
    const out = resample48kTo24k(input);
    expect(out.length).toBe(6);
  });

  it("returns empty buffer for empty input", () => {
    const out = resample48kTo24k(Buffer.alloc(0));
    expect(out.length).toBe(0);
  });

  it("preserves DC offset roughly", () => {
    // All samples at value 1000 (steady DC). Output should also be near 1000
    // once the IIR settles (it converges quickly with ALPHA=0.45).
    const samples = 1000;
    const input = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) input.writeInt16LE(1000, i * 2);
    const out = resample48kTo24k(input);

    // Skip the first ~10 samples for IIR settling, then check.
    const settledIdx = 10;
    const lastValue = out.readInt16LE((out.length / 2 - 1) * 2);
    const settledValue = out.readInt16LE(settledIdx * 2);
    expect(Math.abs(lastValue - 1000)).toBeLessThan(50);
    expect(Math.abs(settledValue - 1000)).toBeLessThan(200);
  });

  it("throws on odd byte length", () => {
    expect(() => resample48kTo24k(Buffer.alloc(7))).toThrow(/not a multiple of 2/);
  });

  it("clamps to int16 range without overflow", () => {
    // Max amplitude input — make sure we don't overflow on the IIR sum.
    const samples = 200;
    const input = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) input.writeInt16LE(32767, i * 2);
    const out = resample48kTo24k(input);
    for (let i = 0; i < out.length / 2; i++) {
      const v = out.readInt16LE(i * 2);
      expect(v).toBeLessThanOrEqual(32767);
      expect(v).toBeGreaterThanOrEqual(-32768);
    }
  });
});
