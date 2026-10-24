import { Client, Events, MessageFlags } from "discord.js";
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
import { createSlotApi, slotScope } from "./slot-api.ts";
import { createSlotDiscord } from "./slot-discord.ts";
import { FileSlotState } from "./slot-state.ts";
import { createSlotWorker } from "./slot-worker.ts";
import { FileRewardState } from "./rewards-state.ts";
import { rewardScopes, rewardActivityScope } from "./rewards-api.ts";
import { createRewardsRuntime, gatewayIntents } from "./rewards-runtime.ts";
import { isRewardsInteraction } from "./rewards-handler.ts";
import { campaignScope,campaignSubmitScope, createCampaignApi } from './campaign-api.ts';
import { createCampaignHandler, isCampaignInteraction } from './campaign-handler.ts';

async function main() {
  const config = loadConfig();
  const api = createApi(config);
  // Validate the restricted client identity before starting the Discord connection.
  const identity = await api.identity();
  const campaigns = config.campaignsEnabled && identity.scopes.includes(campaignScope)
    ? createCampaignHandler(createCampaignApi(config), {...config,submissionsEnabled:config.campaignSubmissionsEnabled&&identity.scopes.includes(campaignSubmitScope)}, undefined, code => console.error(JSON.stringify({ type: 'campaign', code }))) : undefined;
  if (!["identity:read", "account:read", "events:read"].every(s => identity.scopes.includes(s))) throw Error("API-client mist benodigde leesrechten.");
  if (config.ticketParentChannelId && (identity.readOnly || !ticketScopes.every(s => identity.scopes.includes(s)))) throw Error("Ticketclient mist benodigde ticketrechten.");
  let v2Enabled = config.ticketingV2 && configScopes.every(s => identity.scopes.includes(s));
  if (config.ticketingV2 && !v2Enabled) console.error(JSON.stringify({ type: "ticket", code: "v2_configuration_scopes_missing" }));
  let state = config.ticketingV2 ? new FileV2State(config.stateDir!, config.guildId, config.applicationId) : undefined;
  if (state) {
    try { await state.load(); }
    catch { v2Enabled = false; state = undefined; console.error(JSON.stringify({ type: "ticket", code: "v2_state_unavailable" })); }
  }
  if (config.slotWorkerEnabled && !identity.scopes.includes(slotScope)) throw Error("Slotworker mist slots:deliver.");
  const rewardsLog = (code: string) => console.error(JSON.stringify({ type: "rewards", code }));
  let rewardJournal: FileRewardState | undefined;
  if (config.rewardsEnabled) {
    if (!rewardScopes.every(s => identity.scopes.includes(s))) rewardsLog("rewards_scopes_missing");
    else try { rewardJournal = new FileRewardState(config.stateDir!, { apiUrl: config.apiUrl, guildId: config.guildId, applicationId: config.applicationId, clientId: identity.clientId }); }
    catch { rewardsLog("rewards_state_unavailable"); }
  }
  const rewardActivity = Boolean(rewardJournal && config.rewardsActivityEnabled && identity.scopes.includes(rewardActivityScope));
  if (config.rewardsActivityEnabled && !rewardActivity) rewardsLog("rewards_activity_unavailable");
  const client = new Client({ intents: gatewayIntents(Boolean(config.ticketParentChannelId), rewardActivity),
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
  const slotLog = (code: string) => console.error(JSON.stringify({ type: "slot", code }));
  // Open the bound durable journal only when explicitly enabled. The default performs zero slot requests.
  let slotState: FileSlotState | undefined;
  try { if (config.slotWorkerEnabled) slotState = new FileSlotState(config.stateDir!, {
    apiUrl: config.apiUrl, guildId: config.guildId, applicationId: config.applicationId, clientId: identity.clientId }); }
  catch (e) { rewardJournal?.close(); client.destroy(); throw e; }
  const slots = slotState ? createSlotWorker(createSlotApi(config), createSlotDiscord(config.token), slotState, slotLog) : undefined;
  const rewards = rewardJournal ? createRewardsRuntime(client, config, rewardJournal, rewardActivity, rewardsLog) : undefined;
  let enabled = false;
  client.once(Events.ClientReady, ready => { void (async () => {
    if (ready.application.id !== config.applicationId) {
      console.error("Bot-token hoort niet bij de ingestelde applicatie."); slotState?.close(); rewardJournal?.close(); client.destroy(); process.exitCode = 1; return;
    }
    if (discord) await discord.parent();
    enabled = true;
    if (rewards) { await rewards.start(); console.info("BESC Bucks en XP ingeschakeld; automatische activiteit heeft een afzonderlijke opt-in."); }
    if (slots) { void slots.tick(); timers.push(setInterval(() => { void slots.tick(); }, 15_000)); }
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
  })().catch(async () => { log("ticket_startup_configuration_unavailable"); await rewards?.stop(); slotState?.close(); client.destroy(); process.exitCode = 1; });
  });
  client.on(Events.InteractionCreate, interaction => {
    if (!enabled || !(interaction.isChatInputCommand() || interaction.isModalSubmit() || interaction.isButton() || interaction.isStringSelectMenu())) return;
    void (async () => {
      if (interaction.isChatInputCommand() && isCampaignInteraction(interaction)) {
        if (campaigns) await campaigns(interaction);
        else await interaction.reply({ content: 'Campagnes zijn hier nog niet ingeschakeld of vereisen beheercontrole.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        return;
      }
      if ((interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu()) && isRewardsInteraction(interaction)) {
        if (rewards) await rewards.handler(interaction);
        else await interaction.reply({ content: "BESC Bucks en XP is hier nog niet ingeschakeld of vereist beheercontrole.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (v2Handler && await v2Handler(interaction)) return;
      if (ticketHandler && (interaction.isChatInputCommand() || interaction.isModalSubmit()) && await ticketHandler(interaction)) return;
      if (interaction.isChatInputCommand()) await handler(interaction);
    })().catch(() => log("ticket_interaction_unavailable"));
  });
  client.on(Events.MessageCreate, message => { if (enabled) { if (ingest) void ingest.message(message); rewards?.message(message); } });
  client.on(Events.ShardResume, () => { if (enabled) { if (ingest) void ingest.sync(); rewards?.resumed(); } });
  if (rewardActivity && rewards) {
    client.on(Events.VoiceStateUpdate, (_old, next) => { if (enabled) rewards.voice(next.guild.id); });
    client.on(Events.ShardDisconnect, () => rewards.disconnected());
    client.on(Events.ShardReconnecting, () => rewards.disconnected());
    client.on(Events.Invalidated, () => rewards.disconnected());
    client.on(Events.ShardReady, () => { if (enabled) rewards.resumed(); });
    client.on(Events.GuildUnavailable, guild => { if (guild.id === config.guildId) rewards.disconnected(); });
    client.on(Events.GuildAvailable, guild => { if (enabled && guild.id === config.guildId) rewards.resumed(); });
  }
  client.on(Events.Error, () => console.error("Discord-verbinding meldt een fout."));
  const stop = () => { enabled = false; for (const timer of timers) clearInterval(timer);
    void (async () => { await Promise.all([slots?.stop(), rewards?.stop()]); slotState?.close(); client.destroy(); })().catch(() => { client.destroy(); process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try { await client.login(config.token); } catch (e) { await rewards?.stop(); slotState?.close(); throw e; }
}
main().catch(() => { console.error("Bot niet gestart. Controleer instellingen en API-bereikbaarheid; geheimen worden niet gelogd."); process.exitCode = 1; });
