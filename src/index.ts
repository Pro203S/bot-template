import 'colors';
import ora from 'ora';
import env from '../discord-env.example';
import { Client, REST } from 'discord.js';

const handleError = (err: unknown) => {
    if (err instanceof Error) {
        console.error(err.message.red);
        if (err.stack)
            console.error(err.stack.dim);
        process.exit(1);
    }

    console.error(String(err).red);
    process.exit(1);
};

(async () => {
    const spinner = ora("Starting...");

    try {
        const client = new Client(env.clientOptions);
        const rest = new REST()
    } catch (e) {
        handleError(e);
    } finally {
        spinner.stop();
    }
})();
