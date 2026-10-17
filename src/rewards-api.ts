import { ApiError, createTransport } from "./api.ts";
import { snowflake, uuid } from "./ticket-api.ts";

export const rewardScopes = ["rewards:own:read", "rewards:own:write"] as const;
export const rewardActivityScope = "rewards:activity:ingest";
export type RewardLedger = { id: string; kind: string; xp_delta: number; bucks_delta: number; reserved_delta: number; reason: string; created_at: string };
export type RewardAccount = { xp: number; level: number; bucks: number; reserved: number; available: number; ledger: RewardLedger[]; nextOffset: number | null };
export type RewardItem = { id: string; title: string; description: string; price: number; version: number; available_stock: number | null };
export type RewardRequest = { id: string; title: string; price: number; status: "pending" | "approved" | "rejected" | "cancelled" | "fulfilled"; reason: string; version: number; created_at: string; decided_at: string | null };
export type RewardRule = { organization_id: string; guild_id: string; kind: "text" | "voice"; channel_ids: string[]; xp: number; bucks: number; cooldown_seconds: number; daily_xp: number; daily_bucks: number; enabled: true; version: number; voice_min_participants: number; exclude_muted: boolean; exclude_deafened: boolean; exclude_afk: boolean };
export type RewardConfig = { enabled: boolean; rules: RewardRule[] };
export type RewardActivity = { kind: "text"; channel_id: string; occurred_at: string } | { kind: "voice"; channel_id: string; started_at: string; occurred_at: string; eligible_participants: number; muted: boolean; deafened: boolean; afk: boolean };
export type RewardWrite = { ok: true; requestId: string | null; xpDelta: number; bucksDelta: number; reservedDelta: number };
export type RewardJob = { id: string; actor: string; operation: "request" | "cancel" | "activity"; data: Record<string, unknown> };
export interface RewardsApi {
  account(actor: string, offset?: number): Promise<RewardAccount>;
  catalog(actor: string, offset?: number): Promise<{ items: RewardItem[]; nextOffset: number | null }>;
  requests(actor: string, offset?: number): Promise<{ requests: RewardRequest[]; nextOffset: number | null }>;
  config(): Promise<RewardConfig>;
  write(job: RewardJob): Promise<RewardWrite>;
}
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const integer = (v: unknown, min = 0, max = 9_000_000_000_000): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const string = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const date = (v: unknown): v is string => string(v, 40, 1) && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const invalid = (): never => { throw new ApiError("invalid_response", 502); };
function page(b: Record<string, unknown>, offset: number) {
  if (b.schemaVersion !== 1 || !(b.nextOffset === null || integer(b.nextOffset, offset + 25, 99975) && b.nextOffset === offset + 25)) invalid();
  return b.nextOffset as number | null;
}
function rows(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length > 25 || !v.every(record) || new Set(v.map(x => x.id)).size !== v.length) invalid();
  return v as Record<string, unknown>[];
}
export function validRewardJob(v: unknown): v is RewardJob {
  if (!record(v) || !string(v.id, 128, 8) || !string(v.actor, 20, 17) || !snowflake.test(v.actor) || !record(v.data)) return false;
  const d = v.data;
  if (v.operation === "request") return snowflake.test(v.id) && Object.keys(d).sort().join() === "reward_id,version" && typeof d.reward_id === "string" && uuid.test(d.reward_id) && integer(d.version, 1);
  if (v.operation === "cancel") return snowflake.test(v.id) && Object.keys(d).sort().join() === "id,version" && typeof d.id === "string" && uuid.test(d.id) && integer(d.version, 1);
  if (v.operation !== "activity" || !string(d.channel_id, 20, 17) || !snowflake.test(d.channel_id) || !date(d.occurred_at)) return false;
  if (d.kind === "text") return snowflake.test(v.id) && Object.keys(d).sort().join() === "channel_id,kind,occurred_at"
    && Math.abs(Number((BigInt(v.id) >> 22n) + 1420070400000n) - Date.parse(d.occurred_at)) <= 1000;
  return d.kind === "voice" && Object.keys(d).sort().join() === "afk,channel_id,deafened,eligible_participants,kind,muted,occurred_at,started_at"
    && date(d.started_at) && Date.parse(d.occurred_at) - Date.parse(d.started_at) >= 60_000 && Date.parse(d.occurred_at) - Date.parse(d.started_at) <= 75_000
    && integer(d.eligible_participants, 1, 1000) && [d.muted, d.deafened, d.afk].every(x => typeof x === "boolean");
}
export function validRewardWrite(b: unknown, job: RewardJob): b is RewardWrite {
  if (!record(b) || b.ok !== true || !(b.requestId === null || typeof b.requestId === "string" && uuid.test(b.requestId))
    || ![b.xpDelta, b.bucksDelta, b.reservedDelta].every(x => integer(x, -1000000, 1000000))) return false;
  if (job.operation === "request") return b.requestId !== null && b.xpDelta === 0 && b.bucksDelta === 0 && Number(b.reservedDelta) > 0;
  if (job.operation === "cancel") return b.requestId === job.data.id && b.xpDelta === 0 && b.bucksDelta === 0 && Number(b.reservedDelta) < 0;
  return b.requestId === null && Number(b.xpDelta) >= 0 && Number(b.bucksDelta) >= 0 && Number(b.xpDelta) + Number(b.bucksDelta) > 0 && b.reservedDelta === 0;
}
export function parseRewardConfig(b: Record<string, unknown>, guild: string): RewardConfig {
  if (b.schemaVersion !== 1 || typeof b.enabled !== "boolean" || !Array.isArray(b.rules) || b.rules.length > 2 || !b.enabled && b.rules.length !== 0) return invalid();
  const kinds = new Set<string>();
  const rules = b.rules.map((r: unknown): RewardRule => {
    if (!record(r) || typeof r.organization_id !== "string" || !uuid.test(r.organization_id) || r.guild_id !== guild || !["text", "voice"].includes(String(r.kind)) || kinds.has(String(r.kind))
      || r.enabled !== true || !integer(r.version, 1) || !Array.isArray(r.channel_ids) || r.channel_ids.length > 100 || !r.channel_ids.length || !r.channel_ids.every(x => typeof x === "string" && snowflake.test(x))
      || !integer(r.xp, 0, 100000) || !integer(r.bucks, 0, 100000) || r.xp + r.bucks <= 0 || !integer(r.cooldown_seconds, 60, 86400)
      || !integer(r.daily_xp, r.xp, 1000000) || !integer(r.daily_bucks, r.bucks, 1000000) || !integer(r.voice_min_participants, 1, 1000)
      || ![r.exclude_muted, r.exclude_deafened, r.exclude_afk].every(x => typeof x === "boolean")) return invalid();
    kinds.add(String(r.kind));
    return { organization_id: r.organization_id, guild_id: guild, kind: r.kind as RewardRule["kind"], channel_ids: [...new Set(r.channel_ids as string[])], xp: r.xp, bucks: r.bucks,
      cooldown_seconds: r.cooldown_seconds, daily_xp: r.daily_xp, daily_bucks: r.daily_bucks, enabled: true, version: r.version, voice_min_participants: r.voice_min_participants,
      exclude_muted: r.exclude_muted as boolean, exclude_deafened: r.exclude_deafened as boolean, exclude_afk: r.exclude_afk as boolean };
  });
  return { enabled: b.enabled, rules };
}
export function createRewardsApi(config: { apiUrl: string; apiKey: string; guildId: string }, fetcher: typeof fetch = fetch, timeoutMs = 8000): RewardsApi {
  const request = createTransport(config, fetcher, timeoutMs, 262144);
  async function get(resource: string, actor: string, offset: number) {
    if (!snowflake.test(actor) || !integer(offset, 0, 99975)) throw new ApiError("invalid_fields", 400);
    return request(`rewards/${resource}`, { discord_user_id: actor, offset: String(offset) });
  }
  return {
    async account(actor, offset = 0) {
      const b = await get("account", actor, offset), nextOffset = page(b, offset);
      if (![b.xp, b.bucks, b.reserved, b.available].every(x => integer(x)) || !integer(b.level, 0, 100) || Number(b.reserved) > Number(b.bucks) || b.available !== Number(b.bucks) - Number(b.reserved)) return invalid();
      const ledger = rows(b.ledger).map(e => {
        if (typeof e.id !== "string" || !uuid.test(e.id) || !["manual", "correction", "activity", "reserve", "spend", "release", "fulfill"].includes(String(e.kind))
          || ![e.xp_delta, e.bucks_delta, e.reserved_delta].every(x => integer(x, -1000000, 1000000)) || !string(e.reason, 1000, 1) || !date(e.created_at)) return invalid();
        return { id: e.id, kind: e.kind as string, xp_delta: e.xp_delta as number, bucks_delta: e.bucks_delta as number, reserved_delta: e.reserved_delta as number, reason: e.reason, created_at: e.created_at };
      });
      return { xp: b.xp as number, level: b.level, bucks: b.bucks as number, reserved: b.reserved as number, available: b.available as number, ledger, nextOffset };
    },
    async catalog(actor, offset = 0) {
      const b = await get("catalog", actor, offset), nextOffset = page(b, offset);
      const items = rows(b.items).map(r => {
        if (typeof r.id !== "string" || !uuid.test(r.id) || !string(r.title, 120, 1) || !string(r.description, 2000) || !integer(r.price, 1, 1000000) || !integer(r.version, 1) || !(r.available_stock === null || integer(r.available_stock, 0, 1000000))) return invalid();
        return { id: r.id, title: r.title, description: r.description, price: r.price, version: r.version, available_stock: r.available_stock as number | null };
      }); return { items, nextOffset };
    },
    async requests(actor, offset = 0) {
      const b = await get("requests", actor, offset), nextOffset = page(b, offset);
      const requests = rows(b.requests).map(r => {
        if (typeof r.id !== "string" || !uuid.test(r.id) || !string(r.title, 120, 1) || !integer(r.price, 1, 1000000) || !integer(r.version, 1)
          || !["pending", "approved", "rejected", "cancelled", "fulfilled"].includes(String(r.status)) || !string(r.reason, 1000) || !date(r.created_at) || !(r.decided_at === null || date(r.decided_at))) return invalid();
        return { id: r.id, title: r.title, price: r.price, version: r.version, status: r.status as RewardRequest["status"], reason: r.reason, created_at: r.created_at, decided_at: r.decided_at as string | null };
      }); return { requests, nextOffset };
    },
    async config() { return parseRewardConfig(await request("rewards/config"), config.guildId); },
    async write(job) {
      if (!validRewardJob(job)) throw new ApiError("invalid_fields", 400);
      const { id, ...cancelData } = job.data;
      const data = job.operation === "cancel" ? cancelData : job.data;
      const body = { discord_user_id: job.actor, idempotency_key: job.id, data };
      if (Buffer.byteLength(JSON.stringify({ ...body, guild_id: config.guildId })) > 8192) throw new ApiError("body_too_large", 413);
      const path = job.operation === "request" ? "requests" : job.operation === "cancel" ? `requests/${id}/cancel` : "activity";
      const b = await request(`rewards/${path}`, {}, body);
      if (b.schemaVersion !== 1 || !validRewardWrite(b, job)) return invalid();
      return { ok: true, requestId: b.requestId, xpDelta: b.xpDelta, bucksDelta: b.bucksDelta, reservedDelta: b.reservedDelta };
    },
  };
}
