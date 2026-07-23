import { Events, type ChatInputCommandInteraction, type Client, type ClientEvents, type ClientOptions, type MessageContextMenuCommandInteraction, type PrimaryEntryPointCommandInteraction, type REST, type RESTOptions, type UserContextMenuCommandInteraction } from "discord.js";

export type Environment = {
    "token": string;
    "app_id": string;
    "clientOptions": ClientOptions;
    "restOptions"?: Partial<RESTOptions>,
    "environments"?: Record<string, string>
};

type CallbackParameters<T> = T & {
    client: Client<true>;
    rest: REST;
};

//#region CommandModule

type CommandModuleMap = {
    "slash": ChatInputCommandInteraction;
    "messageContextMenu": MessageContextMenuCommandInteraction;
    "userContextMenu": UserContextMenuCommandInteraction;
    "primaryEntry": PrimaryEntryPointCommandInteraction;
};

export type CommandModule<K extends keyof CommandModuleMap = keyof CommandModuleMap> = [
    K,
    (params: CallbackParameters<{ interaction: CommandModuleMap[K] }>) => unknown
];

//#endregion

//#region EventModule

type EventModuleMap = ClientEvents;

export type EventModule<K extends keyof EventModuleMap = keyof EventModuleMap> = [
    K,
    (params: CallbackParameters<{
        "eventArgs": ClientEvents[K],
        "removeListener": () => void
    }>) => unknown
];

//#endregion
