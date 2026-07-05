/**
 * Provider factory + fallback wiring.
 *
 * VOICE_PROVIDER env var selects the default:
 *   - "azure_voice_live" (default): AzureVoiceLiveProvider
 *   - "deepgram": DeepgramProvider
 *
 * If VOICE_ENABLE_DEEPGRAM_FALLBACK=true AND the default provider's
 * startSession() throws, we initialize Deepgram and use it instead.
 *
 * Plan: docs/superpowers/plans/2026-05-31-voice-live-refactor.md (mrt-ai-agent-platform).
 */
import { AzureVoiceLiveProvider } from "./azure-voice-live.js";
import { DeepgramProvider } from "./deepgram.js";
export { AzureVoiceLiveProvider } from "./azure-voice-live.js";
export { DeepgramProvider } from "./deepgram.js";
/**
 * Build the primary provider based on env. Does NOT call startSession; the
 * caller decides when to open the session and gets the chance to drive the
 * fallback path via `withFallback` below.
 */
export function buildPrimaryProvider(env) {
    const choice = (env.VOICE_PROVIDER ?? "azure_voice_live").toLowerCase();
    switch (choice) {
        case "azure_voice_live": {
            const endpoint = req(env.AZURE_VOICE_LIVE_ENDPOINT, "AZURE_VOICE_LIVE_ENDPOINT");
            const apiKey = req(env.AZURE_VOICE_LIVE_API_KEY, "AZURE_VOICE_LIVE_API_KEY");
            return new AzureVoiceLiveProvider({
                endpoint,
                apiKey,
                apiVersion: env.AZURE_VOICE_LIVE_API_VERSION,
                model: env.AZURE_VOICE_LIVE_MODEL,
            });
        }
        case "deepgram": {
            const apiKey = req(env.DEEPGRAM_API_KEY, "DEEPGRAM_API_KEY");
            return new DeepgramProvider({ apiKey });
        }
        default:
            throw new Error(`Unknown VOICE_PROVIDER: ${env.VOICE_PROVIDER} — expected 'azure_voice_live' or 'deepgram'`);
    }
}
/**
 * Build a Deepgram fallback if the env supports it. Returns null when
 * fallback is disabled or DEEPGRAM_API_KEY is missing.
 */
export function buildFallbackProvider(env) {
    const enabled = (env.VOICE_ENABLE_DEEPGRAM_FALLBACK ?? "").toLowerCase() === "true";
    if (!enabled)
        return null;
    if (!env.DEEPGRAM_API_KEY)
        return null;
    return new DeepgramProvider({ apiKey: env.DEEPGRAM_API_KEY });
}
/**
 * Start `primary`, falling back to `fallback` if primary's startSession throws.
 * Logs which path was selected. Returns the active provider.
 */
export async function startWithFallback(primary, fallback, logger) {
    try {
        await primary.startSession();
        logger.info(`voice: provider=${primary.name} active`);
        return primary;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!fallback) {
            logger.error(`voice: primary provider=${primary.name} failed; no fallback configured — voice disabled`, { error: msg });
            throw err;
        }
        logger.warn(`voice: primary provider=${primary.name} failed; falling back to provider=${fallback.name}`, { error: msg });
        await fallback.startSession();
        logger.info(`voice: provider=${fallback.name} active (via fallback)`);
        return fallback;
    }
}
// ── helpers ─────────────────────────────────────────────────────────────────
function req(v, name) {
    if (!v) {
        throw new Error(`voice provider factory: missing required env var ${name}`);
    }
    return v;
}
//# sourceMappingURL=index.js.map