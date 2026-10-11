import { REST, Routes } from "discord.js";
import { createBescCommand } from "./commands.ts";
import { loadConfig } from "./config.ts";
const definition = createBescCommand(Boolean(process.env.DISCORD_TICKET_PARENT_CHANNEL_ID?.trim())).toJSON();
if (!process.argv.includes("--apply")) {
  console.info(JSON.stringify(definition, null, 2));
  console.info("Voorbeeld; niets geregistreerd. Registreren wijzigt één /besc-commando op de ingestelde server en vereist toestemming.");
} else {
  try {
    const config = loadConfig();
    const rest = new REST({ version: "10" }).setToken(config.token);
    // Upsert just /besc. Never bulk-replace guild commands, which could delete other application commands.
    const registered = await rest.post(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body: definition }) as { name: string };
    if (registered.name !== "besc") throw Error("unexpected_registration");
    console.info("/besc geregistreerd op de ingestelde server.");
  } catch { console.error("Registratie mislukt. Controleer instellingen en toestemming."); process.exitCode = 1; }
}
