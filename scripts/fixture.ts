import { randomBytes } from "node:crypto";
import { BotRateLimiter, hashBotKey, handleBotRequest, type BotStore, type BotClient, type BotEvent } from "../tests/support/commandcenter/src/lib/bot-api.ts";
export const fixtureGuild = "111111111111111111";
export const fixtureDiscord = "222222222222222222";
export const fixtureOrg = "11111111-1111-4111-8111-111111111111";
export const fixtureKey = `bb_fixture-discord.${randomBytes(32).toString("base64url")}`;
export function fixture() {
  const client: BotClient = { id: "fixture-discord", keyHash: hashBotKey(fixtureKey), organizationId: fixtureOrg,
    guildId: fixtureGuild, scopes: ["identity:read", "account:read", "events:read"], expiresAt: "2099-01-01T00:00:00Z", revoked: false };
  const calls: Array<{ type: string; organizationId?: string; discordId?: string; offset?: number }> = [];
  const rows: BotEvent[] = Array.from({ length: 6 }, (_, i) => ({ id: `fixture-event-${i}`, title: `TESTFIXTURE — NIET PUBLICEREN ${i + 1}`,
    status: "planning", event_type: "community", start_at: null, start_date: null, location: null, is_online: true }));
  const store: BotStore = {
    async findAccount(discordId) { calls.push({ type: "account", discordId }); return discordId === fixtureDiscord ? { userId: "fixture-user", verifiedDiscordId: fixtureDiscord, banned: false } : null; },
    async findMembership(_userId, organizationId) { calls.push({ type: "membership", organizationId }); return organizationId === fixtureOrg
      ? { organization_id: fixtureOrg, role: "member", status: "active", finance_role: "none" } : null; },
    async listEvents(organizationId, offset, count) { calls.push({ type: "events", organizationId, offset }); return organizationId === fixtureOrg ? rows.slice(offset, offset + count) : []; },
  };
  const limiter = new BotRateLimiter(1000);
  return { client, store, calls, rows, handle: (request: Request) => handleBotRequest(request, { clients: [client], store, limiter }) };
}
