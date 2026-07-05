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
import type { PluginLogger } from "@paperclipai/plugin-sdk";
import type { VoiceProvider } from "../types.js";
export { AzureVoiceLiveProvider } from "./azure-voice-live.js";
export { DeepgramProvider } from "./deepgram.js";
export interface ProviderEnv {
    VOICE_PROVIDER?: string;
    VOICE_ENABLE_DEEPGRAM_FALLBACK?: string;
    AZURE_VOICE_LIVE_ENDPOINT?: string;
    AZURE_VOICE_LIVE_API_KEY?: string;
    AZURE_VOICE_LIVE_API_VERSION?: string;
    AZURE_VOICE_LIVE_MODEL?: string;
    DEEPGRAM_API_KEY?: string;
}
/**
 * Build the primary provider based on env. Does NOT call startSession; the
 * caller decides when to open the session and gets the chance to drive the
 * fallback path via `withFallback` below.
 */
export declare function buildPrimaryProvider(env: ProviderEnv): VoiceProvider;
/**
 * Build a Deepgram fallback if the env supports it. Returns null when
 * fallback is disabled or DEEPGRAM_API_KEY is missing.
 */
export declare function buildFallbackProvider(env: ProviderEnv): VoiceProvider | null;
/**
 * Start `primary`, falling back to `fallback` if primary's startSession throws.
 * Logs which path was selected. Returns the active provider.
 */
export declare function startWithFallback(primary: VoiceProvider, fallback: VoiceProvider | null, logger: PluginLogger): Promise<VoiceProvider>;
