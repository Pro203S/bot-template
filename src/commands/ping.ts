import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { defineCommand } from "types";

const module = defineCommand([
    "slash",
    {
        "description": "퐁"
    },
    async ({ interaction }) => {
        await interaction.reply({
            "content": "퐁",
            "components": [new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("button-asdf")
                        .setLabel("label")
                        .setStyle(ButtonStyle.Primary)
                ).toJSON()]
        });
    }
]);

export default module;
