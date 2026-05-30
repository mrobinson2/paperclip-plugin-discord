import type { PluginContext } from "@paperclipai/plugin-sdk";
interface InteractionOption {
    name: string;
    value?: string | number | boolean;
    options?: InteractionOption[];
    focused?: boolean;
}
interface InteractionData {
    name: string;
    custom_id?: string;
    component_type?: number;
    options?: InteractionOption[];
}
interface Interaction {
    type: number;
    data?: InteractionData;
    member?: {
        user: {
            username: string;
        };
    };
    channel_id?: string;
}
export interface CommandContext {
    baseUrl: string;
    companyId: string;
    /** Discord bot token — used for Discord API calls. */
    token: string;
    /** Optional Paperclip board API key — attached to Paperclip API calls that
     * require board authentication (approve/reject, create issues, etc.).
     * Empty string disables the Authorization header, which is correct for
     * `local_trusted` deployments. */
    paperclipBoardApiKey?: string;
    defaultChannelId: string;
    /** PluginContext for lazy company-ID resolution at command time. */
    pluginCtx?: PluginContext;
}
export declare const SLASH_COMMANDS: {
    name: string;
    description: string;
    options: ({
        name: string;
        description: string;
        type: number;
        options?: undefined;
    } | {
        name: string;
        description: string;
        type: number;
        options: {
            name: string;
            description: string;
            type: number;
            required: boolean;
        }[];
    } | {
        name: string;
        description: string;
        type: number;
        options: {
            name: string;
            description: string;
            type: number;
            required: boolean;
            autocomplete: boolean;
        }[];
    } | {
        name: string;
        description: string;
        type: number;
        options: {
            name: string;
            description: string;
            type: number;
            required: boolean;
            choices: {
                name: string;
                value: string;
            }[];
        }[];
    } | {
        name: string;
        description: string;
        type: number;
        options: ({
            name: string;
            description: string;
            type: number;
            options: {
                name: string;
                description: string;
                type: number;
                required: boolean;
            }[];
        } | {
            name: string;
            description: string;
            type: number;
            options?: undefined;
        })[];
    })[];
}[];
export declare function handleInteraction(ctx: PluginContext, interaction: Interaction, cmdCtx: CommandContext): Promise<unknown>;
export {};
