import { ApiError, createTransport } from "./api.ts";
import { uuid, snowflake, type Ticket } from "./ticket-api.ts";
import { bad, object, ticketConfig, typeRevision, configDelivery, type TicketConfig, type TypeRevision, type ConfigDelivery } from "./ticket-v2-schema.ts";
export type Intent = { intentId: string; expiresAt: string; typeRevisionId: string };
export type IntentSource = { source: "slash" } | { source: "panel"; panel_id: string; panel_revision_id: string; channel_id: string; message_id: string };
export type RuntimeReport = { application_id: string; installed: true; runtime_version: string; features: string[]; channels: { id: string; name: string; type: 0 }[] };
export interface V2Api {
  config(): Promise<TicketConfig>;
  revision(id: string): Promise<TypeRevision>;
  intent(actor: string, revision: string, source: IntentSource, key: string): Promise<Intent>;
  intake(actor: string, revision: string, intent: string, answers: Record<string, string | string[]>, key: string): Promise<Ticket>;
  report(data: RuntimeReport): Promise<void>;
  claim(worker: string): Promise<ConfigDelivery[]>;
  inspect(d: ConfigDelivery, worker: string): Promise<ConfigDelivery>;
  complete(d: ConfigDelivery, worker: string, result: Record<string, unknown>): Promise<void>;
  fail(d: ConfigDelivery, worker: string, code: string, uncertain: boolean): Promise<void>;
}
export function createV2Api(config: { apiUrl: string; apiKey: string; guildId: string; applicationId: string }, fetcher: typeof fetch = fetch): V2Api {
  const request = createTransport(config, fetcher, 8000, 2097152);
  const id = (v: string) => { if (!uuid.test(v)) throw new ApiError("invalid_config", 400); return v; };
  const actor = (v: string) => { if (!snowflake.test(v)) throw new ApiError("invalid_query", 400); return v; };
  async function write(path: string, body: Record<string, unknown>, key: string) {
    actor(key);
    try { return await request(path, {}, body, key); }
    catch (e) { if (!(e instanceof ApiError) || !["api_timeout", "api_unavailable", "upstream_unavailable"].includes(e.code)) throw e; return request(path, {}, body, key); }
  }
  async function recorded(path: string, body: Record<string, unknown>) { if ((await request(path, {}, body)).recorded !== true) return bad(); }
  return {
    async config() { return ticketConfig(await request("ticket-config"), config.guildId); },
    async revision(revision) {
      const r = await request(`ticket-config/revisions/${id(revision)}`);
      if (r.schemaVersion !== 2 || r.guildId !== config.guildId) return bad();
      const t = typeRevision(r.typeRevision); if (t.revisionId !== revision || !t.active) return bad(); return t;
    },
    async intent(user, revision, source, key) {
      const r = await write("ticket-intents", { discord_user_id: actor(user), type_revision_id: id(revision), ...source }, key);
      if (typeof r.intentId !== "string" || !uuid.test(r.intentId) || r.typeRevisionId !== revision || typeof r.expiresAt !== "string" || !Number.isFinite(Date.parse(r.expiresAt))) return bad();
      return r as Intent;
    },
    async intake(user, revision, intent, answers, key) {
      const r = await write("tickets/intake", { discord_user_id: actor(user), type_revision_id: id(revision), intake_intent_id: id(intent), answers }, key);
      if (typeof r.ticketId !== "string" || !uuid.test(r.ticketId) || !["open", "in_progress", "waiting_requester", "closed"].includes(String(r.status))
        || typeof r.linkStatus !== "string" || !(r.threadId === null || typeof r.threadId === "string" && snowflake.test(r.threadId))) return bad();
      return r as Ticket;
    },
    report(data) { return recorded("bot-runtime/report", data); },
    async claim(worker) {
      const r = await request("bot-config-deliveries/claim", {}, { worker_id: worker });
      if (!Array.isArray(r.deliveries) || r.deliveries.length > 5) return bad();
      const deliveries = r.deliveries.map(v => configDelivery(v, config.guildId, config.applicationId));
      if (new Set(deliveries.map(d => d.id)).size !== deliveries.length || new Set(deliveries.map(d => d.panelId ?? `${d.kind}:${d.channelId ?? ""}`)).size !== deliveries.length) return bad();
      return deliveries;
    },
    async inspect(d, worker) {
      const r = await request(`bot-config-deliveries/${id(d.id)}`, { worker_id: worker, lease_token: d.leaseToken });
      if (r.id !== d.id || r.kind !== d.kind || r.leaseToken !== d.leaseToken || typeof r.withdrawn !== "boolean"
        || typeof r.leasedUntil !== "string" || Date.parse(r.leasedUntil) !== Date.parse(d.leasedUntil)) return bad();
      return { ...d, withdrawn: r.withdrawn, leasedUntil: r.leasedUntil };
    },
    complete(d, worker, result) { return recorded(`bot-config-deliveries/${id(d.id)}/complete`, { ...result, application_id: config.applicationId,
      payload_hash: d.payloadHash, kind: d.kind, worker_id: worker, lease_token: d.leaseToken }); },
    fail(d, worker, code, uncertain) { return recorded(`bot-config-deliveries/${id(d.id)}/fail`, { worker_id: worker, lease_token: d.leaseToken, error_code: code, uncertain }); },
  };
}
