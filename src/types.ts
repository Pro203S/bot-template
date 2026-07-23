import type { ClientOptions, RESTOptions } from "discord.js";

export type Environment = {
    "token": string;
    "app_id": string;
    "clientOptions": ClientOptions;
    "restOptions"?: Partial<RESTOptions>
};
