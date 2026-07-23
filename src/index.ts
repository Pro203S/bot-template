import 'colors';
import ora from 'ora';
import fs from 'fs';
import { Client, REST } from 'discord.js';

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
    } catch (e) {
        spinner.stop();
        handleError(e);
    }
})();
