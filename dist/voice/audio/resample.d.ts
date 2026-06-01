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
/**
 * Decimate 48kHz mono PCM16 to 24kHz mono PCM16.
 *
 * @param pcm48  Input buffer. Length must be even (each sample is 2 bytes).
 *               Length is NOT required to be a multiple of 4 — if the sample
 *               count is odd we drop the trailing sample to keep the 2:1 ratio.
 * @returns      Output buffer of length floor(pcm48.length / 4) * 2 bytes
 *               (one output sample per two input samples).
 */
export declare function resample48kTo24k(pcm48: Buffer): Buffer;
