import { AutocompleteInteraction, ButtonInteraction, ChannelSelectMenuInteraction, EntryPointCommandHandlerType, Events, MentionableSelectMenuInteraction, ModalSubmitInteraction, RoleSelectMenuInteraction, StringSelectMenuInteraction, type ChatInputCommandInteraction, type Client, type ClientEvents, type ClientOptions, type MessageContextMenuCommandInteraction, type PrimaryEntryPointCommandInteraction, type REST, type RESTOptions, type UserContextMenuCommandInteraction } from "discord.js";

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

type CommandInfoMap = {
    "slash": {
        "description": string,
        "arguments"?: CommandInfoArguments[]
    }
    "messageContextMenu": {
        "description": string
    }
    "userContextMenu": {
        "description": string
    }
    "primaryEntry": {
        "description": string,
        "handler": EntryPointCommandHandlerType
    }
};

type CommandInfoChoice<T = number | string> = {
    "name": string,
    "value": T
};

type CommandInfoArgumentsBase<T = string, ADD = {}, ChoicesType = string | number> = {
    "type": T,
    "name": string,
    "description": string,
    "required"?: boolean,
    "choices"?: CommandInfoChoice<ChoicesType>[]
} & Partial<ADD>;

type CommandInfoArguments =
    CommandInfoArgumentsBase<"string", { "maxLength": number, "minLength": number, "autoComplete": boolean }, string> |
    CommandInfoArgumentsBase<"integer", { "maxValue": number, "minValue": number }, number> |
    CommandInfoArgumentsBase<"boolean"> |
    CommandInfoArgumentsBase<"user"> |
    CommandInfoArgumentsBase<"channel"> |
    CommandInfoArgumentsBase<"role"> |
    CommandInfoArgumentsBase<"mentionable"> |
    CommandInfoArgumentsBase<"number", { "maxValue": number, "minValue": number }> |
    CommandInfoArgumentsBase<"attachment">;

export type CommandModule<K extends keyof CommandModuleMap = keyof CommandModuleMap> = [
    K,
    CommandInfoMap[K],
    (params: CallbackParameters<{ interaction: CommandModuleMap[K] }>) => unknown
];

//#endregion

//#region EventModule

type EventModuleMap = ClientEvents;

export type EventModule<K extends keyof EventModuleMap = keyof EventModuleMap> = [
    K,
    (params: CallbackParameters<{
        "eventArgs": EventModuleMap[K],
        "removeListener": () => void
    }>) => unknown
];

//#endregion

//#region InteractionModule

type InteractionModuleMap = {
    "button": ButtonInteraction,
    "autoComplete": AutocompleteInteraction,
    "modalSubmit": ModalSubmitInteraction,
    "stringSelect": StringSelectMenuInteraction,
    "roleSelect": RoleSelectMenuInteraction,
    "mentionableSelect": MentionableSelectMenuInteraction,
    "channelSelect": ChannelSelectMenuInteraction
};

export type InteractionModule<K extends keyof InteractionModuleMap = keyof InteractionModuleMap> = [
    K,
    (params: CallbackParameters<{
        "eventArgs": InteractionModuleMap[K],
        "removeListener": () => void
    }>) => unknown
];

//#endregion
