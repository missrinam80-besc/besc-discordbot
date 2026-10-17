import { ChannelType, GatewayIntentBits, PermissionFlagsBits, type Client, type Message } from "discord.js";
import type { BotConfig } from "./config.ts";
import { createRewardsApi } from "./rewards-api.ts";
import { createRewardsWorker } from "./rewards-worker.ts";
import { createRewardsHandler } from "./rewards-handler.ts";
import { RewardsActivity, type VoiceFact } from "./rewards-activity.ts";
import type { FileRewardState } from "./rewards-state.ts";

export function gatewayIntents(tickets: boolean, activity: boolean) {
  return [...new Set([GatewayIntentBits.Guilds, ...(tickets ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] : []),
    ...(activity ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates] : [])])];
}
export function createRewardsRuntime(client: Client, config: BotConfig, state: FileRewardState, activityEnabled: boolean, log: (code: string) => void = () => {}) {
  const api = createRewardsApi(config);
  const worker = createRewardsWorker(api, state, activityEnabled, log);
  const collector = new RewardsActivity(config.guildId, job => worker.enqueue(job), log);
  const handler = createRewardsHandler(api, worker, config.guildId, config.applicationId, log);
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false, started = false, refreshPending: Promise<void> | undefined;
  function facts(): VoiceFact[] | undefined {
    const guild = client.guilds.cache.get(config.guildId);
    if (!client.isReady() || !guild?.available || !guild.members.me) return;
    return [...guild.voiceStates.cache.values()].filter(v => Boolean(v.channelId)).map(v => {
      const channel = v.channel;
      const visible = channel?.type === ChannelType.GuildVoice && Boolean(channel.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.ViewChannel));
      return { actor: v.id, channel: v.channelId!, known: visible && Boolean(v.member), bot: v.member?.user.bot ?? true,
        muted: v.mute, deafened: v.deaf, afk: guild.afkChannelId === v.channelId };
    });
  }
  function sample(transition = false) {
    if (!activityEnabled || stopped) return;
    const snapshot = facts();
    if (!snapshot) { collector.connection(false); return; }
    const stamp = Date.now();
    if (transition) collector.tick(stamp);
    collector.observe(snapshot, stamp); collector.tick(stamp); collector.observe(snapshot, stamp);
  }
  function refresh(): Promise<void> {
    if (!activityEnabled || stopped) return Promise.resolve();
    if (!refreshPending) refreshPending = (async () => {
      try { const next = await api.config(); if (!stopped) collector.setConfig(next, Date.now()); }
      catch { collector.invalidate(); log("rewards_config_unavailable"); }
    })().finally(() => { refreshPending = undefined; });
    return refreshPending;
  }
  return {
    handler,
    async start() {
      if (stopped || started) return; started = true;
      timers.push(setInterval(() => { void worker.tick(); }, 500));
      void worker.tick();
      if (activityEnabled) {
        collector.connection(client.isReady()); await refresh(); if (stopped) return; sample();
        timers.push(setInterval(() => sample(), 5000), setInterval(() => { void refresh(); }, 60_000));
      }
    },
    message(m: Message) {
      if (!activityEnabled || stopped || !client.isReady()) return;
      collector.text({ id: m.id, actor: m.author.id, guild: m.guildId, channel: m.channelId, bot: m.author.bot,
        webhook: Boolean(m.webhookId), system: m.system, timestamp: m.createdTimestamp }, Date.now());
    },
    voice(guild: string) { if (guild === config.guildId) sample(true); },
    disconnected() { collector.connection(false); },
    resumed() { if (activityEnabled && !stopped) { collector.connection(client.isReady()); void refresh(); sample(); } },
    async stop() {
      stopped = true; collector.connection(false); for (const timer of timers) clearInterval(timer);
      await Promise.all([worker.stop(), refreshPending]); state.close();
    },
  };
}
