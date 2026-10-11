import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.ts";
import { createApi } from "./api.ts";
import { createCommandHandler } from "./handler.ts";
import { createTicketApi, ticketScopes } from "./ticket-api.ts";
import { DiscordTickets } from "./ticket-discord.ts";
import { createTicketHandler } from "./ticket-handler.ts";
import { createTicketWorker } from "./ticket-worker.ts";
import { createTicketIngest } from "./ticket-ingest.ts";

async function main() {
  const config = loadConfig();
  const api = createApi(config);
  // Validate the restricted client identity before starting the Discord connection.
  const identity = await api.identity();
  if (!["identity:read", "account:read", "events:read"].every(s => identity.scopes.includes(s))) throw Error("API-client mist benodigde leesrechten.");
  if (config.ticketParentChannelId && (identity.readOnly || !ticketScopes.every(s => identity.scopes.includes(s)))) throw Error("Ticketclient mist benodigde ticketrechten.");
  const client = new Client({ intents: [GatewayIntentBits.Guilds, ...(config.ticketParentChannelId
    ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] : [])],
    rest: { timeout: 8000, retries: 0, rejectOnRateLimit: () => true }, allowedMentions: { parse: [] } });
  const handler = createCommandHandler(api, config.guildId, undefined, record => console.error(JSON.stringify(record)), config.webUrl);
  const log = (code: string) => console.error(JSON.stringify({ type: "ticket", code }));
  const ticketApi = config.ticketParentChannelId ? createTicketApi({ ...config, ticketParentChannelId: config.ticketParentChannelId }) : undefined;
  const discord = ticketApi && config.ticketParentChannelId ? new DiscordTickets(client, config.guildId, config.ticketParentChannelId, ticketApi) : undefined;
  const ticketHandler = ticketApi && discord ? createTicketHandler(ticketApi, discord, log) : undefined;
  const worker = ticketApi && discord ? createTicketWorker(ticketApi, discord, log) : undefined;
  const ingest = ticketApi && discord ? createTicketIngest(ticketApi, discord, log) : undefined;
  const timers: ReturnType<typeof setInterval>[] = [];
  let enabled = false;
  client.once(Events.ClientReady, ready => { void (async () => {
    if (ready.application.id !== config.applicationId) {
      console.error("Bot-token hoort niet bij de ingestelde applicatie."); client.destroy(); process.exitCode = 1; return;
    }
    if (discord) await discord.parent();
    enabled = true;
    console.info("BESC-bot verbonden. Alleen /besc; geen moderatie of rolbeheer.");
    if (worker && ingest) {
      void worker(); void ingest.sync();
      timers.push(setInterval(() => { void worker(); }, 5000), setInterval(() => { void ingest.sync(); }, 60_000));
      console.info("Ticketing actief op het ingestelde intakekanaal; bijlagen en berichtwijzigingen worden niet geïmporteerd.");
    }
  })().catch(() => { log("ticket_startup_configuration_unavailable"); client.destroy(); process.exitCode = 1; });
  });
  client.on(Events.InteractionCreate, interaction => {
    if (!enabled || !(interaction.isChatInputCommand() || interaction.isModalSubmit())) return;
    void (async () => {
      if (ticketHandler && await ticketHandler(interaction)) return;
      if (interaction.isChatInputCommand()) await handler(interaction);
    })().catch(() => log("ticket_interaction_unavailable"));
  });
  client.on(Events.MessageCreate, message => { if (enabled && ingest) void ingest.message(message); });
  client.on(Events.ShardResume, () => { if (enabled && ingest) void ingest.sync(); });
  client.on(Events.Error, () => console.error("Discord-verbinding meldt een fout."));
  const stop = () => { enabled = false; for (const timer of timers) clearInterval(timer); client.destroy(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await client.login(config.token);
}
main().catch(() => { console.error("Bot niet gestart. Controleer instellingen en API-bereikbaarheid; geheimen worden niet gelogd."); process.exitCode = 1; });
