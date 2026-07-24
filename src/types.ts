import {
    AutocompleteInteraction,
    ButtonInteraction,
    ChannelSelectMenuInteraction,
    EntryPointCommandHandlerType,
    MentionableSelectMenuInteraction,
    ModalSubmitInteraction,
    RoleSelectMenuInteraction,
    StringSelectMenuInteraction,
    type ChatInputCommandInteraction,
    type Client,
    type ClientEvents,
    type ClientOptions,
    type MessageContextMenuCommandInteraction,
    type PrimaryEntryPointCommandInteraction,
    type REST,
    type RESTOptions,
    type UserContextMenuCommandInteraction
} from "discord.js";

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

export type CommandModule<K extends keyof CommandModuleMap = keyof CommandModuleMap> = {
    [Type in K]: [
        Type,
        CommandInfoMap[Type],
        (params: CallbackParameters<{ interaction: CommandModuleMap[Type] }>) => unknown
    ]
}[K];

export const defineCommand = <Type extends keyof CommandModuleMap>(module: [
    Type,
    CommandInfoMap[NoInfer<Type>],
    (params: CallbackParameters<{ interaction: CommandModuleMap[NoInfer<Type>] }>) => unknown
]) => module;

//#endregion

//#region EventModule

type EventModuleMap = ClientEvents;

export type EventModule<K extends keyof EventModuleMap = keyof EventModuleMap> = {
    [Event in K]: [
        Event,
        (params: CallbackParameters<{
            "eventArgs": EventModuleMap[Event],
            "removeListener": () => void
        }>) => unknown
    ]
}[K];

export const defineEvent = <Event extends keyof EventModuleMap>(module: [
    Event,
    (params: CallbackParameters<{
        "eventArgs": EventModuleMap[NoInfer<Event>],
        "removeListener": () => void
    }>) => unknown
]) => module;

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

export type InteractionModule<K extends keyof InteractionModuleMap = keyof InteractionModuleMap> = {
    [Type in K]: [
        Type,
        (params: CallbackParameters<{
            "eventArgs": InteractionModuleMap[Type],
            "removeListener": () => void
        }>) => unknown
    ]
}[K];

export const defineInteraction = <Type extends keyof InteractionModuleMap>(module: [
    Type,
    (params: CallbackParameters<{
        "eventArgs": InteractionModuleMap[NoInfer<Type>],
        "removeListener": () => void
    }>) => unknown
]) => module;

//#endregion

//#region CustomModule

type CustomModuleMap = {
    "ready": {},
    "error": { "error": unknown },
    "djsDebug": { "message": string },
    "djsWarn": { "message": string },
    "djsError": { "message": string },
    "exit": { "code": number }
};

export type CustomModule<K extends keyof CustomModuleMap = keyof CustomModuleMap> = {
    [Type in K]: [
        Type,
        (params: CallbackParameters<CustomModuleMap[Type]>) => unknown
    ]
}[K];

export const defineCustom = <Type extends keyof CustomModuleMap>(module: [
    Type,
    (params: CallbackParameters<CustomModuleMap[NoInfer<Type>]>) => unknown
]) => module;

//#endregion
