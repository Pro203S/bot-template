import 'colors';
import ora from 'ora';
import fs from 'fs';
import fsP from 'fs/promises';
import { ApplicationCommandOptionType, ApplicationCommandType, Client, REST, Routes, type ClientEvents, type Interaction } from 'discord.js';
import path from 'path';
import wildcardMatch from 'wildcard-match';
import type { CommandModule, CustomModule, EventModule, InteractionModule } from './types';

if (process.argv[2] === "dev")
    (process.env as any).IS_DEV = "true";

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
    "year": "numeric",
    "month": "2-digit",
    "day": "2-digit",
    "hour": "2-digit",
    "minute": "2-digit",
    "second": "2-digit",
    "hourCycle": "h23"
});

const time = () => `[${timeFormat.format(new Date())}]`.white.dim;

const mainFile = "index.ts";

const log = (file: string, content: string) =>
    console.log(`  ${time()} ${file} ${content}`);

const error = (err: unknown, file = mainFile) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${time()} ${file} ${`Error: ${message}`.red}`);

    if (err instanceof Error && err.stack) {
        const stack = err.stack
            .split("\n")
            .map(line => `${time()} ${file} ${line.gray}`)
            .join("\n");
        console.error(stack);
    }
};

const handleError = (err: unknown) => {
    error(err);
    process.exit(1);
};

//#region utils

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

//#endregion

(async () => {
    const now = Date.now();
    const spinner = ora().start(`${time()} ${mainFile} Starting...`);

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
        const hotReloadTimers = new Map<string, NodeJS.Timeout>();
        let dispatchCustomReady: (() => void) | undefined;
        let dispatchRuntimeError: ((error: unknown) => boolean) | undefined;

        const reportRuntimeError = (err: unknown, useCustomHandler = true) => {
            if (useCustomHandler && dispatchRuntimeError) {
                try {
                    if (dispatchRuntimeError(err)) return;
                } catch (dispatchError) {
                    error(dispatchError);
                }
            }

            error(err);
        };

        const runSafely = (callback: () => unknown, useCustomHandler = true) => {
            try {
                const result = callback();
                void Promise.resolve(result)
                    .catch(error => reportRuntimeError(error, useCustomHandler));
            } catch (error) {
                reportRuntimeError(error, useCustomHandler);
            }
        };

        const loadModuleGroup = async (load: () => Promise<void>) => {
            try {
                await load();
            } catch (error) {
                reportRuntimeError(error);
            }
        };

        process.on("uncaughtException", error => reportRuntimeError(error));
        process.on("unhandledRejection", reason => reportRuntimeError(reason));

        const watchForHotReload = (directory: string, reload: () => Promise<void>) => {
            if (process.env.IS_DEV !== "true") return;

            fs.watch(directory, { "recursive": true }, (_, fileName) => {
                if (fileName && !isSourceModule(fileName)) return;

                clearTimeout(hotReloadTimers.get(directory));
                hotReloadTimers.set(directory, setTimeout(() => {
                    hotReloadQueue = hotReloadQueue
                        .then(reload)
                        .catch(reportRuntimeError);
                }, 150));
            });
        };

        if (fs.existsSync("./src/commands")) {
            type LoadedCommand = {
                file: string;
                parts: [string, ...string[]];
                command: CommandModule;
            };
            type CommandHandler = {
                file: string;
                run: CommandModule[2];
            };
            type CommandBody = Record<string, unknown>;

            const commandTypes = {
                "slash": ApplicationCommandType.ChatInput,
                "messageContextMenu": ApplicationCommandType.Message,
                "userContextMenu": ApplicationCommandType.User,
                "primaryEntry": ApplicationCommandType.PrimaryEntryPoint
            } satisfies Record<CommandModule[0], ApplicationCommandType>;
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
            const optionProperties = {
                "required": "required",
                "choices": "choices",
                "autoComplete": "autocomplete",
                "minLength": "min_length",
                "maxLength": "max_length",
                "minValue": "min_value",
                "maxValue": "max_value"
            } as const;

            const readCommands = async (cacheKey: number): Promise<LoadedCommand[]> => {
                const modulePaths = await readSourceModulePaths("./src/commands");

                return Promise.all(modulePaths.map(async modulePath => {
                    const relativePath = path.relative("./src/commands", modulePath);
                    const module: { "default"?: CommandModule } =
                        await import(getSourceImportPath(modulePath, cacheKey));
                    if (!module.default)
                        throw new Error(`${relativePath}: Expected the default export to be a CommandModule tuple.`);

                    const parts = relativePath.replace(/\.[cm]?[jt]s$/, "").split(path.sep);
                    const commandName = parts.shift();
                    if (!commandName) throw new Error(`${relativePath}: Command name cannot be empty.`);

                    return {
                        "file": relativePath.split(path.sep).join("/"),
                        "parts": [commandName, ...parts],
                        "command": module.default
                    };
                }));
            };

            const serializeArguments = (command: CommandModule<"slash">) => (command[1].arguments ?? []).map(argument => {
                const option: CommandBody = {
                    "type": optionTypes[argument.type],
                    "name": argument.name,
                    "description": argument.description
                };
                const values: Partial<Record<keyof typeof optionProperties, unknown>> = argument;

                for (const source of Object.keys(optionProperties) as (keyof typeof optionProperties)[]) {
                    const value = values[source];
                    if (value !== undefined) option[optionProperties[source]] = value;
                }

                return option;
            });

            const serializeTopLevelCommand = (name: string, command: CommandModule): CommandBody => {
                const body: CommandBody = {
                    name,
                    "type": commandTypes[command[0]]
                };

                if (command[0] === "slash") {
                    body.description = command[1].description;
                    body.options = serializeArguments(command);
                } else if (command[0] === "primaryEntry") {
                    body.handler = command[1].handler;
                }

                return body;
            };

            const serializeSubcommand = (name: string, command: CommandModule<"slash">): CommandBody => ({
                "type": ApplicationCommandOptionType.Subcommand,
                name,
                "description": command[1].description,
                "options": serializeArguments(command)
            });

            const buildCommandState = async () => {
                const loadedCommands = await readCommands(Date.now());
                const registeredCommands = new Map<string, CommandBody>();
                const nextHandlers = new Map<string, CommandHandler>();

                for (const { file, parts, command } of loadedCommands) {
                    const [commandName, groupOrSubcommand, subcommand] = parts;

                    if (!groupOrSubcommand) {
                        registeredCommands.set(commandName, serializeTopLevelCommand(commandName, command));
                    } else {
                        if (command[0] !== "slash" || parts.length > 3)
                            throw new Error(`${parts.join("/")}: Nested commands must be slash commands with at most one subcommand group.`);

                        const body = registeredCommands.get(commandName) ?? {
                            "name": commandName,
                            "type": ApplicationCommandType.ChatInput,
                            "description": `${commandName} commands`,
                            "options": []
                        };
                        registeredCommands.set(commandName, body);

                        const options = body.options as CommandBody[];
                        if (!subcommand) {
                            options.push(serializeSubcommand(groupOrSubcommand, command));
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

                            (group.options as CommandBody[])
                                .push(serializeSubcommand(subcommand, command));
                        }
                    }

                    nextHandlers.set(parts.join("/"), { file, "run": command[2] });
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

            let handlers = new Map<string, CommandHandler>();
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
                spinner.start(
                    `${time()} ${mainFile} ${forcePut ? "Registering commands..." : "Reloading commands..."}`
                );

                try {
                    await rest.put(Routes.applicationCommands(env.app_id), { "body": state.body });
                    registeredCommandInfo = commandInfo;
                    commandSourceFingerprint = sourceFingerprint;

                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.succeed(`${time()} ${mainFile} Commands reloaded and registered.`);
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail(`${time()} ${mainFile} Failed to reload commands.`);
                    throw error;
                }
            };

            await loadModuleGroup(() => reloadCommands(true));

            client.on("interactionCreate", interaction => {
                runSafely(() => {
                    if (!interaction.isCommand()) return;

                    const parts = [interaction.commandName];
                    if (interaction.isChatInputCommand()) {
                        const group = interaction.options.getSubcommandGroup(false);
                        const subcommand = interaction.options.getSubcommand(false);
                        if (group) parts.push(group);
                        if (subcommand) parts.push(subcommand);
                    }

                    const handler = handlers.get(parts.join("/"));
                    if (!handler) return;

                    log(handler.file, `Command: /${parts.join(" ")}`);
                    return handler.run({ "client": cli, rest, interaction } as never);
                });
            });

            watchForHotReload("./src/commands", () => reloadCommands());
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
                spinner.start(
                    `${time()} ${mainFile} ${initial ? "Loading events..." : "Reloading events..."}`
                );

                try {
                    const cacheKey = Date.now();
                    const modulePaths = await readSourceModulePaths("./src/events");
                    const nextEvents: RegisteredEvent[] = [];

                    for (const modulePath of modulePaths) {
                        const module: {
                            "default"?: EventModule;
                            "once"?: boolean;
                        } = await import(getSourceImportPath(modulePath, cacheKey));

                        const file = path.relative("./src/events", modulePath)
                            .split(path.sep).join("/");
                        if (!module.default)
                            throw new Error(`${file}: Expected the default export to be an EventModule tuple.`);

                        const eventModule = module.default;
                        const eventName = eventModule[0];
                        const listener = (...eventArgs: any[]) => {
                            log(file, `Event: ${String(eventName)}`);
                            runSafely(() => eventModule[1]({
                                "client": cli,
                                rest,
                                eventArgs,
                                "removeListener": () => client.removeListener(eventName, listener as never)
                            } as never));
                        };

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
                    else spinner.succeed(`${time()} ${mainFile} Events reloaded.`);
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail(`${time()} ${mainFile} Failed to reload events.`);
                    throw error;
                }
            };

            await loadModuleGroup(() => reloadEvents(true));
            watchForHotReload("./src/events", () => reloadEvents());
        }

        if (fs.existsSync("./src/interactions")) {
            type RegisteredInteraction = {
                "file": string;
                "customId": string;
                "matches": (customId: string) => boolean;
                "module": InteractionModule;
                "once": boolean;
            };

            let registeredInteractions = new Map<InteractionModule[0], RegisteredInteraction[]>();
            let interactionSourceFingerprint = "";

            const removeInteraction = (
                type: InteractionModule[0],
                registeredInteraction: RegisteredInteraction
            ) => {
                const remaining = (registeredInteractions.get(type) ?? [])
                    .filter(interaction => interaction !== registeredInteraction);

                if (remaining.length === 0) registeredInteractions.delete(type);
                else registeredInteractions.set(type, remaining);
            };

            const reloadInteractions = async (initial = false) => {
                const sourceFingerprint = await getSourceFingerprint("./src/interactions");
                if (!initial && sourceFingerprint === interactionSourceFingerprint) return;

                const previousSpinnerText = spinner.text;
                const wasSpinnerSpinning = spinner.isSpinning;
                spinner.start(
                    `${time()} ${mainFile} ${initial ? "Loading interactions..." : "Reloading interactions..."}`
                );

                try {
                    const cacheKey = Date.now();
                    const modulePaths = await readSourceModulePaths("./src/interactions");
                    const nextInteractions = new Map<InteractionModule[0], RegisteredInteraction[]>();
                    const interactionKeys = new Set<string>();

                    for (const modulePath of modulePaths) {
                        const module: {
                            "default"?: InteractionModule;
                            "customId"?: string;
                            "once"?: boolean;
                        } = await import(getSourceImportPath(modulePath, cacheKey));

                        const relativePath = path.relative("./src/interactions", modulePath)
                            .split(path.sep).join("/");
                        if (!module.default)
                            throw new Error(`${relativePath}: Expected the default export to be an InteractionModule tuple.`);
                        if (!module.customId)
                            throw new Error(`${relativePath}: Interaction modules must export a customId string.`);

                        const type = module.default[0];
                        const key = `${type}:${module.customId}`;
                        if (interactionKeys.has(key))
                            throw new Error(`${relativePath}: Duplicate interaction key "${key}".`);
                        interactionKeys.add(key);

                        const interactions = nextInteractions.get(type) ?? [];
                        interactions.push({
                            "file": relativePath,
                            "customId": module.customId,
                            "matches": wildcardMatch(module.customId, false),
                            "module": module.default,
                            "once": module.once === true
                        });
                        nextInteractions.set(type, interactions);
                    }

                    registeredInteractions = nextInteractions;
                    interactionSourceFingerprint = sourceFingerprint;

                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.succeed(`${time()} ${mainFile} Interactions reloaded.`);
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail(`${time()} ${mainFile} Failed to reload interactions.`);
                    throw error;
                }
            };

            await loadModuleGroup(() => reloadInteractions(true));

            client.on("interactionCreate", (interaction: Interaction) => {
                runSafely(() => {
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

                    const interactions = registeredInteractions.get(interactionType) ?? [];
                    const registeredInteraction =
                        interactions.find(({ customId }) => customId === interactionId) ??
                        interactions.find(({ matches }) => matches(interactionId));
                    if (!registeredInteraction) return;

                    if (registeredInteraction.once)
                        removeInteraction(interactionType, registeredInteraction);

                    log(registeredInteraction.file, `Interaction: ${interactionType} (${interactionId})`);
                    return registeredInteraction.module[1]({
                        "client": cli,
                        rest,
                        interaction,
                        "removeListener": () =>
                            removeInteraction(interactionType, registeredInteraction)
                    } as never);
                });
            });

            watchForHotReload("./src/interactions", () => reloadInteractions());
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

                for (const custom of customs) {
                    if (custom.once) removeCustom(type, custom.id);

                    log(custom.id, `Custom: ${type}`);
                    runSafely(
                        () => custom.module[1]({
                            "client": cli,
                            rest,
                            ...params
                        } as never),
                        type !== "error"
                    );
                }
            };

            const reloadCustoms = async (initial = false) => {
                const sourceFingerprint = await getSourceFingerprint("./src/customs");
                if (!initial && sourceFingerprint === customSourceFingerprint) return;

                const previousSpinnerText = spinner.text;
                const wasSpinnerSpinning = spinner.isSpinning;
                spinner.start(
                    `${time()} ${mainFile} ${initial ? "Loading customs..." : "Reloading customs..."}`
                );

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
                    else spinner.succeed(`${time()} ${mainFile} Customs reloaded.`);

                    if (!initial) dispatchCustom("ready");
                } catch (error) {
                    if (wasSpinnerSpinning) spinner.text = previousSpinnerText;
                    else spinner.fail(`${time()} ${mainFile} Failed to reload customs.`);
                    throw error;
                }
            };

            await loadModuleGroup(() => reloadCustoms(true));

            dispatchRuntimeError = error => {
                if ((registeredCustoms.get("error")?.length ?? 0) === 0) return false;
                dispatchCustom("error", { error });
                return true;
            };

            client.on("debug", message => dispatchCustom("djsDebug", { message }));
            client.on("warn", message => dispatchCustom("djsWarn", { message }));
            client.on("error", err => {
                if ((registeredCustoms.get("djsError")?.length ?? 0) > 0) {
                    dispatchCustom("djsError", { "message": err.message });
                    return;
                }

                error(err);
            });
            process.once("exit", code => dispatchCustom("exit", { code }));

            dispatchCustomReady = () => dispatchCustom("ready");
            watchForHotReload("./src/customs", () => reloadCustoms());
        }

        spinner.succeed(
            `${time()} ${mainFile} Logged in as ` +
            `${cli.user.username}#${cli.user.discriminator}`.white.bold +
            "!" +
            ` (${Date.now() - now}ms)`.dim
        );
        dispatchCustomReady?.();
    } catch (e) {
        spinner.stop();
        handleError(e);
    }
})();
