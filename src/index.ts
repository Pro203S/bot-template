import 'colors';
import ora from 'ora';
import fs from 'fs';
import fsP from 'fs/promises';
import { Client, REST, type ClientEvents } from 'discord.js';
import path from 'path';
import type { CommandModule, EventModule } from './types';

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
    const spinner = ora().start("Starting...");

    try {
        if (!fs.existsSync("discord-env.ts")) throw new Error("Could not find discord-env.ts. Did you place it in the project root?");
        const env = (await import("./../discord-env")).default;

        const client = new Client(env.clientOptions);
        const rest = new REST(env.restOptions);

        if (env.environments) {
            const entries = Object.entries(env.environments);
            for (const entry of entries) {
                process.env[entry[0]] = entry[1];
            }
        }

        client.once("clientReady", (cli) => {
            spinner.succeed("Logged in as " + `${cli.user.username}#${cli.user.discriminator}`.white.bold);
        });

        await client.login(env.token);
        const cli = await new Promise<Client<true>>(r => client.once("clientReady", r));

        spinner.start("Loading commands...");

        // TODO: commands 안에 커맨드 불러와서 REST.put으로 때려넣기 (SUBCOMMANDGROUP, SUBCOMMAND 핸들도 있어야함)

        spinner.start("Loading events...");

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

            const listener = (...args: ClientEvents[keyof ClientEvents]) => {
                module.default[1]({
                    "client": cli,
                    rest,
                    "eventArgs": args,
                    "removeListener": () => client.removeListener(module.default[0], listener)
                });
            };

            client[module.once ? "once" : "on"](module.default[0], listener);
        }
    } catch (e) {
        spinner.stop();
        handleError(e);
    }
})();
