import 'colors';
import ora from 'ora';
import fs from 'fs';
import fsP from 'fs/promises';
import { ApplicationCommandOptionType, ApplicationCommandType, Client, REST, Routes, type ClientEvents, type Interaction } from 'discord.js';
import path from 'path';
import type { CommandModule, CustomModule, EventModule, InteractionModule } from './types';

if (process.argv[2] === "dev")
    (process.env as any).IS_DEV = "true";

const handleError = (err: unknown) => {
    if (err instanceof Error) {
        console.error(("Error: " + err.message).red);
        if (err.stack)
            console.error(err.stack.dim);
        process.exit(1);
    }

    console.error(String(err).red);
    process.exit(1);
};

const isSourceModule = (fileName: string) =>
    /\.[cm]?[jt]s$/.test(fileName) && !fileName.endsWith(".d.ts");

const readSourceModulePaths = async (directory: string): Promise<string[]> => {
    const entries = await fsP.readdir(directory, { "withFileTypes": true, "encoding": "utf-8" });
    const modulePaths = await Promise.all(entries.map(async entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return readSourceModulePaths(entryPath);
        if (entry.isFile() && isSourceModule(entry.name)) return [entryPath];
        return [];
    }));

    return modulePaths.flat().sort((a, b) => a.localeCompare(b));
};

const getSourceFingerprint = async (directory: string) => {
    const modulePaths = await readSourceModulePaths(directory);
    const sources = await Promise.all(modulePaths.map(async modulePath => [
        path.relative(directory, modulePath).split(path.sep).join("/"),
        await fsP.readFile(modulePath, "utf-8")
    ]));

    return JSON.stringify(sources);
};

const getSourceImportPath = (modulePath: string, cacheKey: number) =>
    `./${path.relative("./src", modulePath).split(path.sep).join("/")}?update=${cacheKey}`;

(async () => {
    const now = Date.now();
    const spinner = ora().start("Starting...");

    try {
        if (!fs.existsSync("discord-env.ts")) throw new Error("Could not find discord-env.ts. Did you place it in the project root?");
        const env = (await import("./../discord-env")).default;

        const client = new Client(env.clientOptions);
        const rest = new REST(env.restOptions).setToken(env.token);

        if (env.environments) {
            const entries = Object.entries(env.environments);
            for (const entry of entries) {
                process.env[entry[0]] = entry[1];
            }
        }

        await client.login(env.token);
        const cli = await new Promise<Client<true>>(r => client.once("clientReady", r));

        let hotReloadQueue = Promise.resolve();
        const hotReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
        let dispatchCustomReady: (() => void) | undefined;

        const watchForHotReload = (directory: string, label: string, reload: () => Promise<void>) => {
            if (process.env.IS_DEV !== "true") return;

            fs.watch(directory, { "recursive": true }, (_, fileName) => {
                if (fileName && !isSourceModule(fileName)) return;

                clearTimeout(hotReloadTimers.get(directory));
                hotReloadTimers.set(directory, setTimeout(() => {
                    hotReloadQueue = hotReloadQueue
                        .then(reload)
                        .catch(error => console.error((`Failed to reload ${label}: ` + String(error)).red));
                }, 150));
            });
        };

        if (fs.existsSync("./src/commands")) {
            type LoadedCommand = {
                parts: string[];
                command: CommandModule;
            };

            const optionTypes = {
                "string": ApplicationCommandOptionType.String,
                "integer": ApplicationCommandOptionType.Integer,
                "boolean": ApplicationCommandOptionType.Boolean,
                "user": ApplicationCommandOptionType.User,
                "channel": ApplicationCommandOptionType.Channel,
                "role": ApplicationCommandOptionType.Role,
                "mentionable": ApplicationCommandOptionType.Mentionable,
                "number": ApplicationCommandOptionType.Number,
                "attachment": ApplicationCommandOptionType.Attachment
            };

            const readCommands = async (directory: string, cacheKey: number, parts: string[] = []): Promise<LoadedCommand[]> => {
                const entries = await fsP.readdir(directory, { "withFileTypes": true, "encoding": "utf-8" });
                entries.sort((a, b) => a.name.localeCompare(b.name));

                const loaded = await Promise.all(entries.map(async entry => {
                    if (entry.isDirectory())
                        return readCommands(path.join(directory, entry.name), cacheKey, [...parts, entry.name]);

                    if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name) || entry.name.endsWith(".d.ts"))
                        return [];

                    const name = entry.name.replace(/\.[cm]?[jt]s$/, "");
                    const module: { "default"?: CommandModule } = await import(
                        `./commands/${[...parts, entry.name].join("/")}?update=${cacheKey}`
                    );

                    if (!module.default) {
                        console.error(`${path.join(...parts, entry.name)}: Expected the default export to be a CommandModule tuple.`.red);
                        return [];
                    }

                    return [{ "parts": [...parts, name], "command": module.default }];
                }));

                return loaded.flat();
            };

            const serializeArguments = (command: CommandModule) => {
                if (command[0] !== "slash" || !("arguments" in command[1])) return [];

                return (command[1].arguments ?? []).map(argument => {
                    const option: Record<string, unknown> = {
                        "type": optionTypes[argument.type],
                        "name": argument.name,
                        "description": argument.description
                    };

                    if (argument.required !== undefined) option.required = argument.required;
                    if (argument.choices !== undefined) option.choices = argument.choices;
                    if ("autoComplete" in argument && argument.autoComplete !== undefined) option.autocomplete = argument.autoComplete;
                    if ("minLength" in argument && argument.minLength !== undefined) option.min_length = argument.minLength;
                    if ("maxLength" in argument && argument.maxLength !== undefined) option.max_length = argument.maxLength;
                    if ("minValue" in argument && argument.minValue !== undefined) option.min_value = argument.minValue;
                    if ("maxValue" in argument && argument.maxValue !== undefined) option.max_value = argument.maxValue;

                    return option;
                });
            };

            const buildCommandState = async () => {
                const loadedCommands = await readCommands("./src/commands", Date.now());
                const registeredCommands = new Map<string, Record<string, unknown>>();
                const nextHandlers = new Map<string, CommandModule[2]>();

                for (const loaded of loadedCommands) {
                    const [commandName, groupOrSubcommand, subcommand] = loaded.parts;
                    const command = loaded.command;

                    if (loaded.parts.length === 1) {
                        const body: Record<string, unknown> = { "name": commandName };

                        switch (command[0]) {
                            case "slash":
                                body.type = ApplicationCommandType.ChatInput;
                                body.description = command[1].description;
                                body.options = serializeArguments(command);
                                break;
                            case "messageContextMenu":
                                body.type = ApplicationCommandType.Message;
                                break;
                            case "userContextMenu":
                                body.type = ApplicationCommandType.User;
                                break;
                            case "primaryEntry":
                                body.type = ApplicationCommandType.PrimaryEntryPoint;
                                if ("handler" in command[1]) body.handler = command[1].handler;
                                break;
                        }

                        registeredCommands.set(commandName, body);
                        nextHandlers.set(commandName, command[2]);
                        continue;
                    }

                    if (command[0] !== "slash" || loaded.parts.length > 3) {
                        console.error(`${loaded.parts.join("/")}: Nested commands must be slash commands with at most one subcommand group.`.red);
                        continue;
                    }

                    let body = registeredCommands.get(commandName);
                    if (!body) {
                        body = {
                            "name": commandName,
                            "type": ApplicationCommandType.ChatInput,
                            "description": `${commandName} commands`,
                            "options": []
                        };
                        registeredCommands.set(commandName, body);
                    }

                    const options = body.options as Record<string, unknown>[];
                    if (loaded.parts.length === 2) {
                        options.push({
                            "type": ApplicationCommandOptionType.Subcommand,
                            "name": groupOrSubcommand,
                            "description": command[1].description,
                            "options": serializeArguments(command)
                        });
                    } else {
                        let group = options.find(option =>
                            option.type === ApplicationCommandOptionType.SubcommandGroup &&
                            option.name === groupOrSubcommand
                        );

                        if (!group) {
                            group = {
                                "type": ApplicationCommandOptionType.SubcommandGroup,
                                "name": groupOrSubcommand,
                                "description": `${groupOrSubcommand} commands`,
                                "options": []
                            };
                            options.push(group);
                        }

                        (group.options as Record<string, unknown>[]).push({
                            "type": ApplicationCommandOptionType.Subcommand,
                            "name": subcommand,
                            "description": command[1].description,
                            "options": serializeArguments(command)
                        });
                    }

                    nextHandlers.set(loaded.parts.join("/"), command[2]);
                }

                return {
                    "body": [...registeredCommands.values()],
                    "handlers": nextHandlers,
                    "info": loadedCommands.map(({ parts, command }) => ({
                        parts,
                        "type": command[0],
                        "commandInfo": command[1]
                    }))
                };
            };

            let handlers = new Map<string, CommandModule[2]>();
            let registeredCommandInfo = "";
            let commandSourceFingerprint = "";

            const reloadCommands = async (forcePut = false) => {
                const sourceFingerprint = await getSourceFingerprint("./src/commands");
                if (!forcePut && sourceFingerprint === commandSourceFingerprint) return;

                const state = await buildCommandState();
                const commandInfo = JSON.stringify(state.info);
                handlers = state.handlers;

                if (!forcePut && commandInfo === registeredCommandInfo) {
                    commandSourceFingerprint = sourceFingerprint;
                    return;
                }

                const previousSpinnerText = spinner.text;
                const wasSpinnerSpinning = spinner.isSpinning;
                spinner.start(forcePut ? "Registering commands..." : "Reloading commands...");

                try {
                    await rest.put(Routes.applicationCommands(env.app_id), { "body": state.body });
                    registeredCommandInfo = commandInfo;
                    commandSourceFingerprint = sourceFingerprint;

                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.succeed("Commands reloaded and registered.");
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail("Failed to reload commands.");
                    throw error;
                }
            };

            await reloadCommands(true);

            client.on("interactionCreate", interaction => {
                if (!interaction.isCommand()) return;

                const parts = [interaction.commandName];
                if (interaction.isChatInputCommand()) {
                    const group = interaction.options.getSubcommandGroup(false);
                    const subcommand = interaction.options.getSubcommand(false);
                    if (group) parts.push(group);
                    if (subcommand) parts.push(subcommand);
                }

                const handler = handlers.get(parts.join("/"));
                if (handler) void handler({ "client": cli, rest, interaction } as never);
            });

            watchForHotReload("./src/commands", "commands", () => reloadCommands());
        }

        if (fs.existsSync("./src/events")) {
            type RegisteredEvent = {
                "eventName": keyof ClientEvents;
                "listener": (...args: any[]) => void;
                "once": boolean;
            };

            let registeredEvents: RegisteredEvent[] = [];
            let eventSourceFingerprint = "";

            const reloadEvents = async (initial = false) => {
                const sourceFingerprint = await getSourceFingerprint("./src/events");
                if (!initial && sourceFingerprint === eventSourceFingerprint) return;

                const previousSpinnerText = spinner.text;
                const wasSpinnerSpinning = spinner.isSpinning;
                spinner.start(initial ? "Loading events..." : "Reloading events...");

                try {
                    const cacheKey = Date.now();
                    const modulePaths = await readSourceModulePaths("./src/events");
                    const nextEvents: RegisteredEvent[] = [];

                    for (const modulePath of modulePaths) {
                        const module: {
                            "default"?: EventModule;
                            "once"?: boolean;
                        } = await import(getSourceImportPath(modulePath, cacheKey));

                        if (!module.default)
                            throw new Error(`${path.relative("./src/events", modulePath)}: Expected the default export to be an EventModule tuple.`);

                        const eventModule = module.default;
                        const eventName = eventModule[0];
                        const listener = (...eventArgs: any[]) => eventModule[1]({
                            "client": cli,
                            rest,
                            eventArgs,
                            "removeListener": () => client.removeListener(eventName, listener as never)
                        } as never);

                        nextEvents.push({ eventName, listener, "once": module.once === true });
                    }

                    for (const event of registeredEvents)
                        client.removeListener(event.eventName, event.listener as never);

                    for (const event of nextEvents) {
                        if (event.once) client.once(event.eventName, event.listener as never);
                        else client.on(event.eventName, event.listener as never);
                    }

                    registeredEvents = nextEvents;
                    eventSourceFingerprint = sourceFingerprint;

                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.succeed("Events reloaded.");
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail("Failed to reload events.");
                    throw error;
                }
            };

            await reloadEvents(true);
            watchForHotReload("./src/events", "events", () => reloadEvents());
        }

        if (fs.existsSync("./src/interactions")) {
            type RegisteredInteraction = {
                "module": InteractionModule;
                "once": boolean;
            };

            let registeredInteractions = new Map<string, RegisteredInteraction>();
            let interactionSourceFingerprint = "";

            const reloadInteractions = async (initial = false) => {
                const sourceFingerprint = await getSourceFingerprint("./src/interactions");
                if (!initial && sourceFingerprint === interactionSourceFingerprint) return;

                const previousSpinnerText = spinner.text;
                const wasSpinnerSpinning = spinner.isSpinning;
                spinner.start(initial ? "Loading interactions..." : "Reloading interactions...");

                try {
                    const cacheKey = Date.now();
                    const modulePaths = await readSourceModulePaths("./src/interactions");
                    const nextInteractions = new Map<string, RegisteredInteraction>();

                    for (const modulePath of modulePaths) {
                        const module: {
                            "default"?: InteractionModule;
                            "customId"?: string;
                            "once"?: boolean;
                        } = await import(getSourceImportPath(modulePath, cacheKey));

                        const relativePath = path.relative("./src/interactions", modulePath);
                        if (!module.default)
                            throw new Error(`${relativePath}: Expected the default export to be an InteractionModule tuple.`);
                        if (!module.customId)
                            throw new Error(`${relativePath}: Interaction modules must export a customId string.`);

                        const key = `${module.default[0]}:${module.customId}`;
                        if (nextInteractions.has(key))
                            throw new Error(`${relativePath}: Duplicate interaction key "${key}".`);

                        nextInteractions.set(key, {
                            "module": module.default,
                            "once": module.once === true
                        });
                    }

                    registeredInteractions = nextInteractions;
                    interactionSourceFingerprint = sourceFingerprint;

                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.succeed("Interactions reloaded.");
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail("Failed to reload interactions.");
                    throw error;
                }
            };

            await reloadInteractions(true);

            client.on("interactionCreate", (interaction: Interaction) => {
                let interactionType: InteractionModule[0] | undefined;

                if (interaction.isButton()) interactionType = "button";
                else if (interaction.isAutocomplete()) interactionType = "autoComplete";
                else if (interaction.isModalSubmit()) interactionType = "modalSubmit";
                else if (interaction.isStringSelectMenu()) interactionType = "stringSelect";
                else if (interaction.isRoleSelectMenu()) interactionType = "roleSelect";
                else if (interaction.isMentionableSelectMenu()) interactionType = "mentionableSelect";
                else if (interaction.isChannelSelectMenu()) interactionType = "channelSelect";

                if (!interactionType) return;

                const interactionId = interaction.isAutocomplete()
                    ? interaction.commandName
                    : "customId" in interaction ? interaction.customId : undefined;
                if (!interactionId) return;

                const key = `${interactionType}:${interactionId}`;
                const registeredInteraction = registeredInteractions.get(key);
                if (!registeredInteraction) return;

                if (registeredInteraction.once) registeredInteractions.delete(key);
                void registeredInteraction.module[1]({
                    "client": cli,
                    rest,
                    "eventArgs": interaction,
                    "removeListener": () => registeredInteractions.delete(key)
                } as never);
            });

            watchForHotReload("./src/interactions", "interactions", () => reloadInteractions());
        }

        if (fs.existsSync("./src/customs")) {
            type CustomType = CustomModule[0];
            type RegisteredCustom = {
                "id": string;
                "module": CustomModule;
                "once": boolean;
            };

            const customTypes = new Set<CustomType>([
                "ready",
                "error",
                "djsDebug",
                "djsWarn",
                "djsError",
                "exit"
            ]);

            let registeredCustoms = new Map<CustomType, RegisteredCustom[]>();
            let customSourceFingerprint = "";

            const removeCustom = (type: CustomType, id: string) => {
                const remaining = (registeredCustoms.get(type) ?? [])
                    .filter(custom => custom.id !== id);

                if (remaining.length === 0) registeredCustoms.delete(type);
                else registeredCustoms.set(type, remaining);
            };

            const dispatchCustom = (type: CustomType, params: Record<string, unknown> = {}) => {
                const customs = [...(registeredCustoms.get(type) ?? [])];

                const reportError = (error: unknown) => {
                    const errorCustoms = registeredCustoms.get("error") ?? [];
                    if (type !== "error" && errorCustoms.length > 0) {
                        dispatchCustom("error", { error });
                        return;
                    }

                    const message = error instanceof Error
                        ? error.stack ?? error.message
                        : String(error);
                    console.error((`Custom "${type}" handler failed: ${message}`).red);
                };

                for (const custom of customs) {
                    if (custom.once) removeCustom(type, custom.id);

                    try {
                        const result = custom.module[1]({
                            "client": cli,
                            rest,
                            ...params
                        } as never);
                        void Promise.resolve(result).catch(reportError);
                    } catch (error) {
                        reportError(error);
                    }
                }
            };

            const reloadCustoms = async (initial = false) => {
                const sourceFingerprint = await getSourceFingerprint("./src/customs");
                if (!initial && sourceFingerprint === customSourceFingerprint) return;

                const previousSpinnerText = spinner.text;
                const wasSpinnerSpinning = spinner.isSpinning;
                spinner.start(initial ? "Loading customs..." : "Reloading customs...");

                try {
                    const cacheKey = Date.now();
                    const modulePaths = await readSourceModulePaths("./src/customs");
                    const nextCustoms = new Map<CustomType, RegisteredCustom[]>();

                    for (const modulePath of modulePaths) {
                        const module: {
                            "default"?: CustomModule;
                            "once"?: boolean;
                        } = await import(getSourceImportPath(modulePath, cacheKey));

                        const relativePath = path.relative("./src/customs", modulePath)
                            .split(path.sep).join("/");
                        if (!module.default)
                            throw new Error(`${relativePath}: Expected the default export to be a CustomModule tuple.`);
                        if (!customTypes.has(module.default[0]))
                            throw new Error(`${relativePath}: Unknown custom type "${String(module.default[0])}".`);
                        if (typeof module.default[1] !== "function")
                            throw new Error(`${relativePath}: Expected CustomModule[1] to be a function.`);

                        const type = module.default[0];
                        const customs = nextCustoms.get(type) ?? [];
                        customs.push({
                            "id": relativePath,
                            "module": module.default,
                            "once": module.once === true
                        });
                        nextCustoms.set(type, customs);
                    }

                    registeredCustoms = nextCustoms;
                    customSourceFingerprint = sourceFingerprint;

                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.succeed("Customs reloaded.");

                    if (!initial) dispatchCustom("ready");
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail("Failed to reload customs.");
                    throw error;
                }
            };

            await reloadCustoms(true);

            client.on("debug", message => dispatchCustom("djsDebug", { message }));
            client.on("warn", message => dispatchCustom("djsWarn", { message }));
            client.on("error", error => {
                if ((registeredCustoms.get("djsError")?.length ?? 0) > 0) {
                    dispatchCustom("djsError", { "message": error.message });
                    return;
                }

                console.error(("Discord.js error: " + (error.stack ?? error.message)).red);
            });
            process.on("uncaughtExceptionMonitor", error => dispatchCustom("error", { error }));
            process.once("exit", code => dispatchCustom("exit", { code }));

            dispatchCustomReady = () => dispatchCustom("ready");
            watchForHotReload("./src/customs", "customs", () => reloadCustoms());
        }

        spinner.succeed("Logged in as " + `${cli.user.username}#${cli.user.discriminator}`.white.bold + "!" + ` (${Date.now() - now}ms)`.dim);
        dispatchCustomReady?.();
    } catch (e) {
        spinner.stop();
        handleError(e);
    }
})();
