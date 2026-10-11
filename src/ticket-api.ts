import { ApiError, createTransport } from "./api.ts";
export const ticketScopes = ["tickets:create", "tickets:own:read", "tickets:ingest", "tickets:deliver"] as const;
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const snowflake = /^[1-9]\d{16,19}$/;
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const invalid = () => { throw new ApiError("invalid_response", 502); };
export type Ticket = { ticketId: string; status: string; linkStatus: string; threadId: string | null };
export type Delivery = { id: string; ticketId: string | null; kind: "create_thread" | "send_message" | "close_thread" | "delete_thread";
  payload: Record<string, unknown>; guildId: string; parentChannelId: string; threadId: string | null; ticketStatus: string | null;
  ticketMarker: string; leaseToken: string; leasedUntil: string; reconcile: boolean; nonce: string };
export interface TicketApi {
  create(actor: string, subject: string, content: string, key: string): Promise<Ticket>;
  own(id: string, actor: string): Promise<Ticket>;
  ingest(ticket: string, actor: string, thread: string, message: string, content: string): Promise<void>;
  claim(worker: string): Promise<Delivery[]>;
  complete(d: Delivery, worker: string, result: Record<string, unknown>): Promise<void>;
  fail(d: Delivery, worker: string, code: string, uncertain: boolean): Promise<void>;
}
function ticket(v: Record<string, unknown>): Ticket {
  if (typeof v.ticketId !== "string" || !uuid.test(v.ticketId) || !["open", "in_progress", "waiting_requester", "closed"].includes(String(v.status))
    || typeof v.linkStatus !== "string" || !(v.threadId === null || typeof v.threadId === "string" && snowflake.test(v.threadId))) return invalid();
  return v as Ticket;
}
export function createTicketApi(config: { apiUrl: string; apiKey: string; guildId: string; ticketParentChannelId: string }, fetcher: typeof fetch = fetch): TicketApi {
  // Own-ticket responses can contain 50 external messages of 4000 Unicode characters.
  const request = createTransport(config, fetcher, 8000, 1_048_576);
  async function retryWrite(path: string, body: Record<string, unknown>, key: string) {
    try { return await request(path, {}, body, key); }
    catch (e) {
      if (!(e instanceof ApiError) || !["api_timeout", "api_unavailable", "upstream_unavailable"].includes(e.code)) throw e;
      return request(path, {}, body, key);
    }
  }
  const id = (value: string) => { if (!uuid.test(value)) throw new ApiError("invalid_ticket", 400); return value; };
  const actor = (value: string) => { if (!snowflake.test(value)) throw new ApiError("invalid_actor", 400); return value; };
  async function recorded(path: string, body: Record<string, unknown>) { if ((await request(path, {}, body)).recorded !== true) invalid(); }
  return {
    async create(user, subject, content, key) {
      if (!snowflake.test(key) || subject.trim().length < 1 || subject.length > 160 || content.trim().length < 1 || content.length > 4000) throw new ApiError("invalid_ticket", 400);
      return ticket(await retryWrite("tickets", { discord_user_id: actor(user), parent_channel_id: config.ticketParentChannelId, subject, content }, key));
    },
    async own(ticketId, user) {
      const result = ticket(await request(`tickets/${id(ticketId)}`, { discord_user_id: actor(user) }));
      if (result.ticketId !== ticketId) return invalid();
      return result;
    },
    async ingest(ticketId, user, thread, message, content) {
      if (!snowflake.test(thread) || !snowflake.test(message) || !content.trim() || content.length > 4000) throw new ApiError("invalid_ticket", 400);
      const result = await retryWrite(`tickets/${id(ticketId)}/messages`, { discord_user_id: actor(user), parent_channel_id: config.ticketParentChannelId,
        thread_id: thread, source_message_id: message, content }, message);
      if (result.ticketId !== ticketId || typeof result.messageId !== "string" || !uuid.test(result.messageId)) invalid();
    },
    async claim(worker) {
      const result = await request("ticket-deliveries/claim", {}, { worker_id: worker });
      if (!Array.isArray(result.deliveries) || result.deliveries.length > 5) return invalid();
      const seen = new Set<string>();
      for (const v of result.deliveries) {
        if (!record(v) || typeof v.id !== "string" || !uuid.test(v.id) || seen.has(v.id) || !record(v.payload)
          || !(v.ticketId === null || typeof v.ticketId === "string" && uuid.test(v.ticketId))
          || !["create_thread", "send_message", "close_thread", "delete_thread"].includes(String(v.kind))
          || (v.kind !== "delete_thread" && (v.ticketId === null || !["open", "in_progress", "waiting_requester", "closed"].includes(String(v.ticketStatus))))
          || v.guildId !== config.guildId || v.parentChannelId !== config.ticketParentChannelId
          || !(v.threadId === null || typeof v.threadId === "string" && snowflake.test(v.threadId))
          || typeof v.ticketMarker !== "string" || !uuid.test(v.ticketMarker.replace(/^besc-ticket-/, "")) || !v.ticketMarker.startsWith("besc-ticket-")
          || (v.ticketId !== null && v.ticketMarker !== `besc-ticket-${v.ticketId}`)
          || typeof v.leaseToken !== "string" || !uuid.test(v.leaseToken) || typeof v.reconcile !== "boolean"
          || typeof v.leasedUntil !== "string" || !Number.isFinite(Date.parse(v.leasedUntil))
          || typeof v.nonce !== "string" || !/^\d{1,25}$/.test(v.nonce)
          || !record(v.allowedMentions) || !Array.isArray(v.allowedMentions.parse) || v.allowedMentions.parse.length !== 0) return invalid();
        if (v.kind === "create_thread" && (v.payload.marker !== v.ticketMarker || typeof v.payload.requester_discord_id !== "string" || !snowflake.test(v.payload.requester_discord_id))) return invalid();
        if (v.kind === "send_message" && (typeof v.payload.content !== "string" || !v.payload.content.trim() || v.payload.content.length > 4000
          || typeof v.payload.message_id !== "string" || !uuid.test(v.payload.message_id))) return invalid();
        seen.add(v.id);
      }
      return result.deliveries as Delivery[];
    },
    async complete(d, worker, result) { await recorded(`ticket-deliveries/${id(d.id)}/complete`, { ...result, worker_id: worker, lease_token: d.leaseToken }); },
    async fail(d, worker, code, uncertain) { await recorded(`ticket-deliveries/${id(d.id)}/fail`, { worker_id: worker, lease_token: d.leaseToken, error_code: code, uncertain }); },
  };
}
