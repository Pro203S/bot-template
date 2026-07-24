import type { CommandModule } from "types";

const command: CommandModule = [
    "slash",
    {
        "description": "퐁"
    },
    async ({ interaction }) => {
        await interaction.reply("퐁");
    }
];

export default command;
