import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.ts";
import { createApi } from "./api.ts";
import { createCommandHandler } from "./handler.ts";
import { createTicketApi, ticketScopes } from "./ticket-api.ts";
import { createTicketHandler } from "./ticket-handler.ts";
import { createTicketWorker } from "./ticket-worker.ts";
import { createTicketContexts } from "./ticket-contexts.ts";
import { FileV2State } from "./ticket-v2-state.ts";
import { createV2Api } from "./ticket-v2-api.ts";
import { configScopes, features } from "./ticket-v2-schema.ts";
import { createConfigWorker } from "./ticket-v2-worker.ts";
import { DiscordConfigEffects } from "./ticket-v2-discord.ts";
import { createV2Handler } from "./ticket-v2-handler.ts";

async function main() {
  const config = loadConfig();
  const api = createApi(config);
  // Validate the restricted client identity before starting the Discord connection.
  const identity = await api.identity();
  if (!["identity:read", "account:read", "events:read"].every(s => identity.scopes.includes(s))) throw Error("API-client mist benodigde leesrechten.");
  if (config.ticketParentChannelId && (identity.readOnly || !ticketScopes.every(s => identity.scopes.includes(s)))) throw Error("Ticketclient mist benodigde ticketrechten.");
  let v2Enabled = config.ticketingV2 && configScopes.every(s => identity.scopes.includes(s));
  if (config.ticketingV2 && !v2Enabled) console.error(JSON.stringify({ type: "ticket", code: "v2_configuration_scopes_missing" }));
  let state = config.ticketingV2 ? new FileV2State(config.stateDir!, config.guildId, config.applicationId) : undefined;
  if (state) {
    try { await state.load(); }
    catch { v2Enabled = false; state = undefined; console.error(JSON.stringify({ type: "ticket", code: "v2_state_unavailable" })); }
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, ...(config.ticketParentChannelId
    ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] : [])],
    rest: { timeout: 8000, retries: 0, rejectOnRateLimit: () => true }, allowedMentions: { parse: [] } });
  const handler = createCommandHandler(api, config.guildId, undefined, record => console.error(JSON.stringify(record)), config.webUrl);
  const log = (code: string) => console.error(JSON.stringify({ type: "ticket", code }));
  const ticketApi = config.ticketParentChannelId ? createTicketApi({ ...config, ticketParentChannelId: config.ticketParentChannelId, storedParentBindings: config.ticketingV2 }) : undefined;
  const contexts = ticketApi && config.ticketParentChannelId ? createTicketContexts(client, { ...config, ticketParentChannelId: config.ticketParentChannelId, storedParentBindings: config.ticketingV2 }, log, state) : undefined;
  const discord = contexts?.legacy;
  const ticketHandler = ticketApi && discord ? createTicketHandler(ticketApi, discord, log) : undefined;
  const worker = ticketApi && contexts ? createTicketWorker(ticketApi, contexts, log) : undefined;
  const ingest = contexts;
  const v2Api = v2Enabled ? createV2Api(config) : undefined;
  const effects = v2Api && state ? new DiscordConfigEffects(client, config.guildId, config.applicationId, state) : undefined;
  const configWorker = v2Api && effects ? createConfigWorker(v2Api, effects, log) : undefined;
  const v2Handler = v2Api && contexts ? createV2Handler(v2Api, config.guildId, config.applicationId, contexts.validateRequester, log) : undefined;
  let reporting = false;
  const report = async () => {
    if (!v2Api || !effects || !contexts || reporting) return; reporting = true;
    try {
      await v2Api.report({ application_id: config.applicationId, installed: true, runtime_version: "2.0.0", features: [...features], channels: await effects.report() });
      const current = await v2Api.config();
      for (const t of current.typeRevisions) await contexts.remember(t.parentChannelId);
    } catch { log("v2_runtime_report_unavailable"); }
    finally { reporting = false; }
  };
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
    if (configWorker) {
      await report(); void configWorker();
      timers.push(setInterval(() => { void configWorker(); }, 5000), setInterval(() => { void report(); }, 60000));
      console.info("Ticketing V2 actief; configuratie en publicaties worden via Command Center gecontroleerd.");
    }
  })().catch(() => { log("ticket_startup_configuration_unavailable"); client.destroy(); process.exitCode = 1; });
  });
  client.on(Events.InteractionCreate, interaction => {
    if (!enabled || !(interaction.isChatInputCommand() || interaction.isModalSubmit() || interaction.isButton() || interaction.isStringSelectMenu())) return;
    void (async () => {
      if (v2Handler && await v2Handler(interaction)) return;
      if (ticketHandler && (interaction.isChatInputCommand() || interaction.isModalSubmit()) && await ticketHandler(interaction)) return;
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
