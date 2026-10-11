import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { canViewInternalPath } from "./route-permissions.ts";
import type { MembershipAccess } from "./permissions.ts";

export type BotScope = "identity:read" | "account:read" | "events:read";
export type BotClient = {
  id: string; keyHash: string; organizationId: string; guildId: string;
  scopes: BotScope[]; expiresAt: string; revoked: boolean;
};
export type BotMember = MembershipAccess & { organization_id: string; status: string };
export type BotEvent = {
  id: string; title: string; status: string; event_type: string;
  start_at: string | null; start_date: string | null; location: string | null; is_online: boolean;
};
export interface BotStore {
  findAccount(discordId: string): Promise<{ userId: string; verifiedDiscordId: string | null; banned: boolean } | null>;
  findMembership(userId: string, organizationId: string): Promise<BotMember | null>;
  listEvents(organizationId: string, offset: number, count: number): Promise<BotEvent[]>;
}
export const hashBotKey = (key: string) => createHash("sha256").update(key).digest("hex");
const snowflake = /^[1-9]\d{16,19}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopes: BotScope[] = ["identity:read", "account:read", "events:read"];
const MAX_EVENT_OFFSET = 99999;

export function parseBotClients(raw: string | undefined): BotClient[] {
  if (!raw) return [];
  const clients: unknown = JSON.parse(raw);
  if (!Array.isArray(clients) || clients.length > 100) throw Error("invalid_bot_clients");
  const ids = new Set<string>();
  return clients.map((value: unknown) => {
    if (!value || typeof value !== "object") throw Error("invalid_bot_clients");
    const c = value as BotClient;
    if (typeof c.id !== "string" || !/^[a-z0-9-]{3,64}$/.test(c.id) || ids.has(c.id)
      || typeof c.keyHash !== "string" || !/^[a-f0-9]{64}$/.test(c.keyHash)
      || typeof c.organizationId !== "string" || !uuid.test(c.organizationId)
      || typeof c.guildId !== "string" || !snowflake.test(c.guildId)
      || !Array.isArray(c.scopes) || !c.scopes.length || c.scopes.some(s => !scopes.includes(s))
      || typeof c.expiresAt !== "string" || !Number.isFinite(Date.parse(c.expiresAt))
      || typeof c.revoked !== "boolean") throw Error("invalid_bot_clients");
    ids.add(c.id);
    return c;
  });
}

class ApiFailure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
// Single-process limit for this read-only pilot. Multi-replica deployments need a shared limiter.
export class BotRateLimiter {
  private windows = new Map<string, { until: number; count: number }>();
  private maximum: number;
  constructor(maximum = 60) { this.maximum = maximum; }
  allow(id: string, now: number) {
    for (const [key, row] of this.windows) if (row.until <= now) this.windows.delete(key);
    const row = this.windows.get(id) ?? { until: now + 60_000, count: 0 };
    this.windows.set(id, row);
    return ++row.count <= this.maximum;
  }
}
const defaultLimiter = new BotRateLimiter();

export async function handleBotRequest(request: Request, deps: {
  clients: BotClient[]; store: BotStore; limiter?: BotRateLimiter; now?: number;
  audit?: (record: { requestId: string; clientId: string | null; resource: string; status: number; code: string }) => void;
}): Promise<Response> {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const resource = url.pathname.split("/").at(-1) ?? "";
  let clientId: string | null = null;
  const reply = (status: number, body: object, code = "ok") => {
    // Audit callback must never turn a successful response into a rejected request.
    try { deps.audit?.({ requestId, clientId, resource: ["identity", "account", "events"].includes(resource) ? resource : "unknown", status, code }); } catch { /* isolated audit failure */ }
    return Response.json(body, { status, headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId,
      ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
      ...(status === 405 ? { Allow: "GET" } : {}),
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    } });
  };
  try {
    if (request.method !== "GET") throw new ApiFailure(405, "read_only");
    const authorization = request.headers.get("authorization") ?? "";
    const match = /^Bearer (bb_([a-z0-9-]{3,64})\.[A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match) throw new ApiFailure(401, "invalid_client");
    const client = deps.clients.find(c => c.id === match[2]);
    const now = deps.now ?? Date.now();
    if (!client || client.revoked || Date.parse(client.expiresAt) <= now
      || !timingSafeEqual(Buffer.from(hashBotKey(match[1]), "hex"), Buffer.from(client.keyHash, "hex"))) {
      throw new ApiFailure(401, "invalid_client");
    }
    clientId = client.id;
    if (!(deps.limiter ?? defaultLimiter).allow(client.id, now)) throw new ApiFailure(429, "rate_limited");
    if (!["identity", "account", "events"].includes(resource)) throw new ApiFailure(404, "not_found");
    const required: BotScope = resource === "identity" ? "identity:read" : resource === "account" ? "account:read" : "events:read";
    if (!client.scopes.includes(required)) throw new ApiFailure(403, "insufficient_scope");
    const allowed = resource === "identity" ? ["guild_id"] : resource === "events"
      ? ["guild_id", "discord_user_id", "offset"] : ["guild_id", "discord_user_id"];
    for (const key of url.searchParams.keys()) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ApiFailure(400, "invalid_query");
    }
    if (url.searchParams.get("guild_id") !== client.guildId) throw new ApiFailure(403, "guild_not_allowed");
    if (resource === "identity") return reply(200, { clientId: client.id, scopes: client.scopes, readOnly: true });
    const discordId = url.searchParams.get("discord_user_id") ?? "";
    if (!snowflake.test(discordId)) throw new ApiFailure(400, "invalid_discord_id");
    const offsetText = url.searchParams.get("offset") ?? "0";
    if (!/^(0|[1-9]\d{0,4})$/.test(offsetText)) throw new ApiFailure(400, "invalid_offset");
    const account = await deps.store.findAccount(discordId);
    // Profiles are user-editable: verify the current Auth identity as well, and never use user_metadata for grants.
    if (!account || account.verifiedDiscordId !== discordId || account.banned) throw new ApiFailure(404, "account_unavailable");
    const member = await deps.store.findMembership(account.userId, client.organizationId);
    if (!member || member.status !== "active" || member.organization_id !== client.organizationId
      || !["admin", "board", "member", "volunteer"].includes(member.role)) throw new ApiFailure(403, "membership_required");
    const canReadEvents = canViewInternalPath("/app/events", member);
    if (resource === "account") return reply(200, { linked: true, activeMember: true, canReadEvents });
    if (!canReadEvents) throw new ApiFailure(403, "events_forbidden");
    const offset = Number(offsetText), count = 5;
    const rows = await deps.store.listEvents(client.organizationId, offset, count + 1);
    // Explicit projection also protects against adapter overfetching.
    const events = rows.slice(0, count).map(e => ({ id: e.id, title: e.title, status: e.status,
      event_type: e.event_type, start_at: e.start_at, start_date: e.start_date,
      location: e.location, is_online: e.is_online }));
    return reply(200, { events, nextOffset: rows.length > count && offset + count <= MAX_EVENT_OFFSET ? offset + count : null });
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : new ApiFailure(503, "upstream_unavailable");
    return reply(failure.status, { error: { code: failure.code, requestId } }, failure.code);
  }
}
