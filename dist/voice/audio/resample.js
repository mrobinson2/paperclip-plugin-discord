/**
 * Audio resampler: PCM16 mono 48kHz → PCM16 mono 24kHz.
 *
 * The Discord receiver pipeline (prism-media Opus decoder) produces PCM16
 * mono 48kHz. Azure Voice Live's `input_audio_format: "pcm16"` expects
 * 24kHz mono PCM16. Deepgram accepts the 48kHz input directly so this
 * resampler is only used for Voice Live.
 *
 * Implementation: simple 2:1 decimation with a single-pole IIR low-pass
 * pre-filter to attenuate frequencies above the new Nyquist (12kHz). For
 * 16kHz speech bandwidth this is more than adequate — speech energy is
 * concentrated below 8kHz and the slight roll-off above that is masked
 * by speech harmonics. We do NOT pull in a full FIR design or a library
 * like libsamplerate; the marginal accuracy isn't worth the dep weight
 * for this use case (transcription accuracy is dominated by the upstream
 * model, not the last 6dB above 8kHz).
 */
/** Cutoff coefficient for the IIR low-pass. Tuned by ear/spectrum for clean speech. */
const ALPHA = 0.45;
/**
 * Decimate 48kHz mono PCM16 to 24kHz mono PCM16.
 *
 * @param pcm48  Input buffer. Length must be even (each sample is 2 bytes).
 *               Length is NOT required to be a multiple of 4 — if the sample
 *               count is odd we drop the trailing sample to keep the 2:1 ratio.
 * @returns      Output buffer of length floor(pcm48.length / 4) * 2 bytes
 *               (one output sample per two input samples).
 */
export function resample48kTo24k(pcm48) {
    if (pcm48.length % 2 !== 0) {
        throw new Error(`resample48kTo24k: input length ${pcm48.length} is not a multiple of 2 (PCM16 requires even-byte input)`);
    }
    const inSamples = pcm48.length / 2;
    const outSamples = Math.floor(inSamples / 2);
    const out = Buffer.alloc(outSamples * 2);
    let lp = 0; // single-pole IIR low-pass state
    for (let i = 0, j = 0; j < outSamples; i += 2, j += 1) {
        // Filter both input samples, output one. y[n] = α·x[n] + (1−α)·y[n−1]
        const x0 = pcm48.readInt16LE(i * 2);
        lp = ALPHA * x0 + (1 - ALPHA) * lp;
        const x1 = pcm48.readInt16LE((i + 1) * 2);
        lp = ALPHA * x1 + (1 - ALPHA) * lp;
        // Take the filtered value at the even-index input sample.
        out.writeInt16LE(clamp16(Math.round(lp)), j * 2);
    }
    return out;
}
function clamp16(n) {
    if (n > 32767)
        return 32767;
    if (n < -32768)
        return -32768;
    return n;
}
//# sourceMappingURL=resample.js.map