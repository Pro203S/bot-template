import 'colors';
import ora from 'ora';
import fs from 'fs';
import fsP from 'fs/promises';
import { ApplicationCommandOptionType, ApplicationCommandType, Client, REST, Routes, type ClientEvents } from 'discord.js';
import path from 'path';
import type { CommandModule, EventModule } from './types';

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

            const readCommands = async (directory: string, parts: string[] = []): Promise<LoadedCommand[]> => {
                const entries = await fsP.readdir(directory, { "withFileTypes": true, "encoding": "utf-8" });
                const loaded = await Promise.all(entries.map(async entry => {
                    if (entry.isDirectory())
                        return readCommands(path.join(directory, entry.name), [...parts, entry.name]);

                    if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name) || entry.name.endsWith(".d.ts"))
                        return [];

                    const name = entry.name.replace(/\.[cm]?[jt]s$/, "");
                    const module: { "default"?: CommandModule } = await import(
                        `./commands/${[...parts, entry.name].join("/")}`
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

            const loadedCommands = await readCommands("./src/commands");
            const registeredCommands = new Map<string, Record<string, unknown>>();
            const handlers = new Map<string, CommandModule[2]>();

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
                    handlers.set(commandName, command[2]);
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

                handlers.set(loaded.parts.join("/"), command[2]);
            }

            await rest.put(Routes.applicationCommands(env.app_id), {
                "body": [...registeredCommands.values()]
            });

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
        }

        if (fs.existsSync("./src/events")) {
            const eventModules = await fsP.readdir("./src/events", { "withFileTypes": true, "encoding": "utf-8" });

            for (const eventModule of eventModules) {
                if (!eventModule.isFile()) {
                    console.warn(`${eventModule} in the events folder is not a file.`.yellow);
                    continue;
                }

                const module: {
                    "default": EventModule,
                    "once"?: boolean
                } = await import(`./events/${path.basename(eventModule.name)}`);

                if (!module.default) {
                    console.error(`${eventModule}: Expected the default export to be an EventModule tuple.`.red);
                    continue;
                }

                const listener = (...args: ClientEvents[keyof ClientEvents]) => module.default[1]({
                    "client": cli,
                    rest,
                    "eventArgs": args,
                    "removeListener": () => client.removeListener(module.default[0], listener)
                });

                client[module.once ? "once" : "on"](module.default[0], listener);
            }
        }

        if (fs.existsSync("./src/interactions")) {
            const interactionModules = await fsP.readdir("./src/interactions", { "withFileTypes": true, "encoding": "utf-8" });

            for (const interactionModule of interactionModules) {
                if (!interactionModule.isFile()) {
                    console.warn(`${interactionModule} in the interactions folder is not a file.`.yellow);
                    continue;
                }

                const module: {
                    "default": EventModule,
                    "customId": string,
                    "once"?: boolean
                } = await import(`./events/${path.basename(interactionModule.name)}`);

                if (!module.default) {
                    console.error(`${interactionModule}: Expected the default export to be an InteractionModule tuple.`.red);
                    continue;
                }

                if (!module.customId) {
                    console.error(`${interactionModule}: Interaction modules must export a customId string.`.red);
                    continue;
                }

                const listener = (...args: ClientEvents[keyof ClientEvents]) => module.default[1]({
                    "client": cli,
                    rest,
                    "eventArgs": args,
                    "removeListener": () => client.removeListener(module.default[0], listener)
                });

                client[module.once ? "once" : "on"](module.default[0], listener);
            }
        }

        spinner.succeed("Logged in as " + `${cli.user.username}#${cli.user.discriminator}`.white.bold + "!" + ` (${Date.now() - now}ms)`.dim);
    } catch (e) {
        spinner.stop();
        handleError(e);
    }
})();
