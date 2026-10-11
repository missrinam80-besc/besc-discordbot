export type BotConfig = { token: string; applicationId: string; guildId: string; apiUrl: string; webUrl: string; apiKey: string };
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
  return config;
}
