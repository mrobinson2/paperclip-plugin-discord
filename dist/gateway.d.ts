import type { PluginContext } from "@paperclipai/plugin-sdk";
interface InteractionCreateEvent {
    id: string;
    token: string;
    type: number;
    data?: Record<string, unknown>;
    member?: {
        user: {
            username: string;
        };
    };
    guild_id?: string;
    channel_id?: string;
}
export interface MessageCreateEvent {
    id: string;
    channel_id: string;
    content: string;
    author: {
        id: string;
        username: string;
        bot?: boolean;
    };
    message_reference?: {
        message_id: string;
        channel_id: string;
        guild_id?: string;
    };
}
/** VOICE_STATE_UPDATE dispatch event payload (Discord Gateway op 0, t = VOICE_STATE_UPDATE). */
export interface VoiceStateUpdateEvent {
    guild_id?: string;
    channel_id: string | null;
    user_id: string;
    session_id: string;
    [key: string]: unknown;
}
/** VOICE_SERVER_UPDATE dispatch event payload (Discord Gateway op 0, t = VOICE_SERVER_UPDATE). */
export interface VoiceServerUpdateEvent {
    token: string;
    guild_id: string;
    endpoint: string | null;
    [key: string]: unknown;
}
/** Arbitrary gateway payload (used by voice.sendPayload to emit op 4 voice state updates). */
export interface GatewaySendPayload {
    op: number;
    d: unknown;
}
type InteractionHandler = (interaction: InteractionCreateEvent) => Promise<unknown>;
type MessageHandler = (message: MessageCreateEvent) => Promise<void>;
type VoiceStateUpdateHandler = (event: VoiceStateUpdateEvent) => void;
type VoiceServerUpdateHandler = (event: VoiceServerUpdateEvent) => void;
export interface GatewayOptions {
    listenForMessages?: boolean;
    includeMessageContent?: boolean;
    /** Enable GUILD_VOICE_STATES intent + VOICE_STATE_UPDATE/VOICE_SERVER_UPDATE dispatch. */
    enableVoice?: boolean;
}
/**
 * Voice-related primitives surfaced on the gateway handle when `enableVoice` is true.
 * Designed to plug straight into a custom @discordjs/voice DiscordGatewayAdapterCreator.
 * See docs/superpowers/research/2026-05-28-plugin-sdk-voice-feasibility.md in the
 * MRTek repo for the architecture rationale.
 */
export interface GatewayVoiceHandle {
    /** Send a raw gateway payload (typically op 4 voice-state-update). Returns true if sent. */
    sendPayload(payload: GatewaySendPayload): boolean;
    /** Subscribe to VOICE_STATE_UPDATE dispatch events. */
    onVoiceStateUpdate(handler: VoiceStateUpdateHandler): void;
    /** Subscribe to VOICE_SERVER_UPDATE dispatch events. */
    onVoiceServerUpdate(handler: VoiceServerUpdateHandler): void;
    /**
     * Resolves once the gateway WebSocket has received READY (so sendPayload can
     * actually deliver the op-4 voice-state-update). Callers MUST await this before
     * joining a voice channel — joining before the socket is OPEN drops the op-4
     * payload silently (sendPayload returns false), Discord never replies with
     * VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE, and @discordjs/voice's join times
     * out. Rejects if the gateway is closed before it becomes ready.
     */
    whenReady(): Promise<void>;
}
export interface GatewayHandle {
    close: () => void;
    /** Present when `options.enableVoice` was true at connect time. */
    voice?: GatewayVoiceHandle;
}
export declare function respondViaCallback(ctx: PluginContext, interactionId: string, interactionToken: string, responseData: unknown): Promise<void>;
export declare function connectGateway(ctx: PluginContext, token: string, onInteraction: InteractionHandler, onMessage?: MessageHandler, options?: GatewayOptions): Promise<GatewayHandle>;
export {};
