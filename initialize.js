import { createInterface } from "node:readline";
import * as fs from 'fs';
import { rm } from "node:fs/promises";

//#region chalk
const foregroundColors = {
    black: 30,
    red: 31,
    green: 32,
    yellow: 33,
    blue: 34,
    magenta: 35,
    cyan: 36,
    white: 37,
    gray: 90,
};

const backgroundColors = {
    black: 40,
    red: 41,
    green: 42,
    yellow: 43,
    blue: 44,
    magenta: 45,
    cyan: 46,
    white: 47,
    gray: 100,
};

const styles = {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29],
};

function ansi(open, close, text) {
    return `\u001B[${open}m${text}\u001B[${close}m`;
}

function createColor(open, close) {
    return (text) => ansi(open, close, text);
}

export const chalk = {
    // styles
    bold: createColor(styles.bold[0], styles.bold[1]),
    dim: createColor(styles.dim[0], styles.dim[1]),
    italic: createColor(styles.italic[0], styles.italic[1]),
    underline: createColor(styles.underline[0], styles.underline[1]),
    inverse: createColor(styles.inverse[0], styles.inverse[1]),
    hidden: createColor(styles.hidden[0], styles.hidden[1]),
    strikethrough: createColor(styles.strikethrough[0], styles.strikethrough[1]),

    // foreground
    black: createColor(30, 39),
    red: createColor(31, 39),
    green: createColor(32, 39),
    yellow: createColor(33, 39),
    blue: createColor(34, 39),
    magenta: createColor(35, 39),
    cyan: createColor(36, 39),
    white: createColor(37, 39),
    gray: createColor(90, 39),

    // background
    bgBlack: createColor(40, 49),
    bgRed: createColor(41, 49),
    bgGreen: createColor(42, 49),
    bgYellow: createColor(43, 49),
    bgBlue: createColor(44, 49),
    bgMagenta: createColor(45, 49),
    bgCyan: createColor(46, 49),
    bgWhite: createColor(47, 49),
    bgGray: createColor(100, 49),

    rgb(text, r, g, b) {
        return `\u001B[38;2;${r};${g};${b}m${text}\u001B[39m`;
    },

    bgRgb(text, r, g, b) {
        return `\u001B[48;2;${r};${g};${b}m${text}\u001B[49m`;
    },

    hex(text, hex) {
        const value = hex.replace("#", "");

        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);

        return chalk.rgb(text, r, g, b);
    },

    bgHex(text, hex) {
        const value = hex.replace("#", "");

        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);

        return chalk.bgRgb(text, r, g, b);
    },

    color(name, text) {
        return ansi(foregroundColors[name], 39, text);
    },

    bgColor(name, text) {
        return ansi(backgroundColors[name], 49, text);
    },
};

//#endregion

//#region Spinner (ConsoleSpinner)

export class ConsoleSpinner {
    constructor() {
        this.frames = [
            chalk.rgb("⠋", 255, 0, 0),
            chalk.rgb("⠙", 255, 85, 0),
            chalk.rgb("⠹", 255, 170, 0),
            chalk.rgb("⠸", 255, 255, 0),
            chalk.rgb("⠼", 128, 255, 0),
            chalk.rgb("⠴", 0, 255, 0),
            chalk.rgb("⠦", 0, 255, 170),
            chalk.rgb("⠧", 0, 170, 255),
            chalk.rgb("⠇", 0, 0, 255),
            chalk.rgb("⠏", 128, 0, 255),
        ];
        this.interval = 80;
        this.text = "";
        this.timer = null;
        this.index = 0;
        this.running = false;
    }

    start(text) {
        if (this.running) {
            return;
        }

        if (text !== undefined) {
            this.text = text;
        }

        this.running = true;
        process.stdout.write("\x1B[?25l");

        this.timer = setInterval(() => {
            const frame = this.frames[this.index % this.frames.length];
            this.index++;

            process.stdout.write(`\r\x1b[35m${frame}\x1b[0m ${this.text}`);
        }, this.interval);
    }

    setText(text) {
        this.text = text;
    }

    stop(finalText) {
        if (!this.running) {
            return;
        }

        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.running = false;
        this.clearLine();
        process.stdout.write("\x1B[?25h");

        if (finalText !== undefined) {
            process.stdout.write(`${finalText}\n`);
        }
    }

    succeed(text = "Done") {
        this.stop(`\x1b[32m✔\x1b[0m ${text}`);
    }

    fail(text = "Failed") {
        this.stop(`\x1b[31m✖\x1b[0m ${text}`);
    }

    clearLine() {
        process.stdout.write("\r\x1B[2K");
    }
}

//#endregion

//#region Update DiscordJS (UpdateDiscordJS)

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

async function UpdateDiscordJS() {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    const latestVersion = await getLatestDiscordJSVersion();

    let changed = false;

    changed = updateDependency(packageJson.dependencies, "discord.js", latestVersion) || changed;
    changed = updateDependency(packageJson.devDependencies, "discord.js", latestVersion) || changed;

    if (!changed) {
        throw new Error("Cannot find discord.js dependency in your package.json");
    }

    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`, "utf8");

    await install();

    return latestVersion;
}

async function getLatestDiscordJSVersion() {
    return new Promise((resolve, reject) => {
        const url = `https://registry.npmjs.org/discord.js/latest`;

        https.get(url, (res) => {
            let body = "";

            res.setEncoding("utf8");

            res.on("data", (chunk) => {
                body += chunk;
            });

            res.on("end", () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`npm registry 요청 실패: HTTP ${res.statusCode}`));
                    return;
                }

                const json = JSON.parse(body);

                if (typeof json.version !== "string") {
                    reject(new Error("latest version을 찾지 못했습니다."));
                    return;
                }

                resolve(json.version);
            });
        }).on("error", reject);
    });
}

function updateDependency(dependencies, name, version) {
    if (dependencies === undefined || dependencies[name] === undefined) {
        return false;
    }

    dependencies[name] = `${version}`;
    return true;
}

async function install() {
    if (process.platform === "win32") {
        const where = await execFileAsync("C:/Windows/System32/where.exe", ["bun"]);
        const rawPath = where.stdout.split("\n").map(v => v.trim()).find(v => v.endsWith(".cmd"));

        if (!rawPath) throw new Error("Cannot find bun.");

        await execFileAsync(rawPath, ["install"]);
        return;
    }
    await execFileAsync("bun", ["install"]);
}

//#endregion

const line = createInterface({
    "input": process.stdin,
    "output": process.stdout
});

const readLine = (q) => new Promise(r => line.question(`${chalk.cyan(chalk.bold('?'))} \x1b[1m${q}\x1b[0m `, r));

(async () => {
    const spinner = new ConsoleSpinner();
    try {
        const name = path.basename(path.dirname(fileURLToPath(import.meta.url)));

        spinner.start("Installing packages...");
        const discordJsLatestVersion = await UpdateDiscordJS();
        spinner.succeed("Updated discord.js to " + chalk.bold(discordJsLatestVersion));

        spinner.start("Setting up some magic...");

        fs.renameSync("README.md", "GUIDE.md");

        const readMe = `# ${name}\r\n`;
        fs.writeFileSync("README.md", readMe, "utf-8");

        const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
        packageJson.name = name;

        delete packageJson.scripts["initialize"];

        fs.writeFileSync("package.json", JSON.stringify(packageJson, null, 4), "utf-8");

        rm("initialize.js");

        fs.renameSync("discord-env.example.ts", "discord-env.ts");

        if (!fs.existsSync("./src/events"))
            fs.mkdirSync("./src/events");

        if (!fs.existsSync("./src/interactions"))
            fs.mkdirSync("./src/interactions");

        if (!fs.existsSync("./src/customs"))
            fs.mkdirSync("./src/customs");

        if (!fs.existsSync("./src/modules"))
            fs.mkdirSync("./src/modules");

        spinner.succeed("Magic complete!");

        spinner.start("Initializing git...");
        rm(".git", { "recursive": true, "force": true });
        await execFileAsync("git", ["init"]);
        spinner.succeed("Initialized git.");
        await execFileAsync("git", ["add", "*"]);
        await execFileAsync("git", ["commit", "-m", "Initial Commit"]);

        console.log(chalk.green("\r\nInitialized the project!"));
    } catch (err) {
        spinner.fail(err.message);
        throw err;
    } finally {
        line.close();
    }
})();
