import { validateUrl } from "./config.ts";

export type Identity = { clientId: string; scopes: string[]; readOnly: true };
export type Account = { linked: true; activeMember: true; canReadEvents: boolean };
export type EventInfo = { id: string; title: string; status: string; event_type: string;
  start_at: string | null; start_date: string | null; location: string | null; is_online: boolean };
export type EventPage = { events: EventInfo[]; nextOffset: number | null };
export interface BotApi {
  identity(): Promise<Identity>;
  account(discordId: string): Promise<Account>;
  events(discordId: string, offset?: number): Promise<EventPage>;
}
export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(code: string, status: number, requestId?: string) { super(code); this.code = code; this.status = status; this.requestId = requestId; }
}
const codes = new Set(["invalid_client", "guild_not_allowed", "insufficient_scope", "account_unavailable", "membership_required",
  "events_forbidden", "rate_limited", "upstream_unavailable", "server_configuration_unavailable", "invalid_query", "invalid_offset"]);
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
export function createApi(config: { apiUrl: string; apiKey: string; guildId: string }, fetcher: typeof fetch = fetch, timeoutMs = 8000): BotApi {
  const base = validateUrl(config.apiUrl, true);
  if (base.pathname !== "/api/v1/bot/") throw Error("invalid_api_url");
  async function get(resource: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const url = new URL(resource, base);
    url.searchParams.set("guild_id", config.guildId);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: "GET", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" } });
      // Bound decoded response size, including when Content-Length is absent.
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError("invalid_response", 502);
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 65_536) { await reader.cancel(); throw new ApiError("invalid_response", 502); }
        chunks.push(part.value);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok) {
        const e = object(body) && object(body.error) ? body.error : {};
        throw new ApiError(typeof e.code === "string" && codes.has(e.code) ? e.code : "upstream_unavailable", response.status,
          typeof e.requestId === "string" && /^[a-f0-9-]{36}$/.test(e.requestId) ? e.requestId : undefined);
      }
      if (!object(body)) throw new ApiError("invalid_response", 502);
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? "api_timeout" : "api_unavailable", 503);
    } finally { clearTimeout(timer); }
  }
  return {
    async identity() {
      const b = await get("identity");
      if (typeof b.clientId !== "string" || !Array.isArray(b.scopes) || !b.scopes.every(s => typeof s === "string") || b.readOnly !== true) throw new ApiError("invalid_response", 502);
      return b as Identity;
    },
    async account(discordId) {
      const b = await get("account", { discord_user_id: discordId });
      if (b.linked !== true || b.activeMember !== true || typeof b.canReadEvents !== "boolean") throw new ApiError("invalid_response", 502);
      return b as Account;
    },
    async events(discordId, offset = 0) {
      const b = await get("events", { discord_user_id: discordId, offset: String(offset) });
      if (!Array.isArray(b.events) || b.events.length > 5 || !(b.nextOffset === null || (Number.isSafeInteger(b.nextOffset) && Number(b.nextOffset) > offset))) throw new ApiError("invalid_response", 502);
      for (const e of b.events) {
        if (!object(e) || !["id", "title", "status", "event_type"].every(k => typeof e[k] === "string")
          || typeof e.is_online !== "boolean" || !["start_at", "start_date", "location"].every(k => e[k] === null || typeof e[k] === "string")) throw new ApiError("invalid_response", 502);
      }
      return b as EventPage;
    },
  };
}
