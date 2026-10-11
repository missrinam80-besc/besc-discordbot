import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.ts";
import { createApi } from "./api.ts";
import { createCommandHandler } from "./handler.ts";

async function main() {
  const config = loadConfig();
  const api = createApi(config);
  // Validate the restricted client identity before starting the Discord connection.
  const identity = await api.identity();
  if (!["identity:read", "account:read", "events:read"].every(s => identity.scopes.includes(s))) throw Error("API-client mist benodigde leesrechten.");
  const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });
  const handler = createCommandHandler(api, config.guildId, undefined, record => console.error(JSON.stringify(record)), config.webUrl);
  let enabled = false;
  client.once(Events.ClientReady, ready => {
    if (ready.application.id !== config.applicationId) {
      console.error("Bot-token hoort niet bij de ingestelde applicatie."); client.destroy(); process.exitCode = 1; return;
    }
    enabled = true;
    console.info("BESC-bot verbonden. Alleen /besc; geen moderatie of rolbeheer.");
  });
  client.on(Events.InteractionCreate, interaction => {
    if (enabled && interaction.isChatInputCommand()) void handler(interaction);
  });
  client.on(Events.Error, () => console.error("Discord-verbinding meldt een fout."));
  process.once("SIGINT", () => client.destroy());
  process.once("SIGTERM", () => client.destroy());
  await client.login(config.token);
}
main().catch(() => { console.error("Bot niet gestart. Controleer instellingen en API-bereikbaarheid; geheimen worden niet gelogd."); process.exitCode = 1; });
