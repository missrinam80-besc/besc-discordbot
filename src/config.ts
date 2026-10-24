import { isAbsolute } from "node:path";
export type BotConfig = { token: string; applicationId: string; guildId: string; apiUrl: string; webUrl: string; apiKey: string; ticketParentChannelId?: string;
  ticketingV2: boolean; slotWorkerEnabled?: boolean; rewardsEnabled?: boolean; rewardsActivityEnabled?: boolean; campaignsEnabled?: boolean;campaignSubmissionsEnabled?:boolean; stateDir?: string };
const snowflake = /^[1-9]\d{16,19}$/;
export function validateUrl(value: string, allowLocal = false) {
  const url = new URL(value);
  const local = allowLocal && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw Error("URL moet HTTPS gebruiken en mag geen credentials, query of fragment bevatten.");
  }
  return url;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const names = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID", "COMMANDCENTER_API_URL", "COMMANDCENTER_WEB_URL", "BESC_BOT_API_KEY"];
  if (names.some(n => !env[n]?.trim())) throw Error("Vul de zes vereiste instellingen uit .env.example in.");
  const config = { token: env.DISCORD_BOT_TOKEN!.trim(), applicationId: env.DISCORD_APPLICATION_ID!.trim(), guildId: env.DISCORD_GUILD_ID!.trim(),
    apiUrl: env.COMMANDCENTER_API_URL!.trim(), webUrl: env.COMMANDCENTER_WEB_URL!.trim(), apiKey: env.BESC_BOT_API_KEY!.trim() };
  if (!snowflake.test(config.applicationId) || !snowflake.test(config.guildId)) throw Error("Ongeldig Discord application- of server-ID.");
  if (!/^bb_[a-z0-9-]{3,64}\.[A-Za-z0-9_-]{43}$/.test(config.apiKey)) throw Error("Ongeldige BESC clientkey.");
  const api = validateUrl(config.apiUrl, true);
  if (api.pathname !== "/api/v1/bot/") throw Error("API-URL moet eindigen op /api/v1/bot/.");
  validateUrl(config.webUrl, true);
  // Only this configured origin receives the client credential. Redirects are rejected in api.ts.
  const ticketParentChannelId = env.DISCORD_TICKET_PARENT_CHANNEL_ID?.trim();
  if (ticketParentChannelId && !snowflake.test(ticketParentChannelId)) throw Error("Ongeldig ticketkanaal-ID.");
  if (env.BESC_TICKETING_V2 && !["true", "false"].includes(env.BESC_TICKETING_V2)) throw Error("Ongeldige V2-instelling.");
  const ticketingV2 = env.BESC_TICKETING_V2 === "true";
  const slotFlag = env.BESC_SLOT_WORKER_ENABLED?.trim() || "false";
  if (!["false", "true"].includes(slotFlag)) throw Error("BESC_SLOT_WORKER_ENABLED moet true of false zijn.");
  const rewardsFlag = env.BESC_REWARDS_ENABLED?.trim() || "false";
  const activityFlag = env.BESC_REWARDS_ACTIVITY_ENABLED?.trim() || "false";
  if (![rewardsFlag, activityFlag].every(x => ["false", "true"].includes(x))) throw Error("Bucks-instellingen moeten true of false zijn.");
  if (activityFlag === "true" && rewardsFlag !== "true") throw Error("Automatisch verdienen vereist de afzonderlijk ingeschakelde Bucks-module.");
  const stateDir = env.BESC_BOT_STATE_DIR?.trim();
  const campaignsFlag = env.BESC_CAMPAIGN_COMMANDS_ENABLED?.trim() || 'false';
  if (!['false', 'true'].includes(campaignsFlag)) throw Error('BESC_CAMPAIGN_COMMANDS_ENABLED moet true of false zijn.');
  const submitFlag=env.BESC_CAMPAIGN_SUBMISSIONS_ENABLED?.trim()||'false';
  if(!['false','true'].includes(submitFlag)||submitFlag==='true'&&campaignsFlag!=='true')throw Error('Bijdragen indienen vereist de afzonderlijk ingeschakelde campagnemodule.');
  if ((ticketingV2 || slotFlag === "true" || rewardsFlag === "true") && (!stateDir || !isAbsolute(stateDir))) throw Error("Workers vereisen een absolute, duurzame BESC_BOT_STATE_DIR.");
  if (ticketingV2 && !ticketParentChannelId) throw Error("V2 vereist het legacykanaal.");
  return { ...config, ticketingV2, ...(stateDir ? { stateDir } : {}), ...(ticketParentChannelId ? { ticketParentChannelId } : {}),
    ...(slotFlag === "true" ? { slotWorkerEnabled: true } : {}), ...(rewardsFlag === "true" ? { rewardsEnabled: true } : {}),
    ...(activityFlag === "true" ? { rewardsActivityEnabled: true } : {}), ...(campaignsFlag === 'true' ? { campaignsEnabled: true } : {}),...(submitFlag==='true'?{campaignSubmissionsEnabled:true}:{}) };
}
