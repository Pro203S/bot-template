import { defineCommand } from "types";

const module = defineCommand([
    "slash",
    {
        "description": "퐁"
    },
    async ({ interaction }) => {
        return await interaction.reply("퐁");
    }
]);

export default module;
