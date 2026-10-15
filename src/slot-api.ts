import { ApiError, createTransport } from "./api.ts";

export const slotScope = "slots:deliver";
export const snowflake = /^[1-9]\d{16,19}$/;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type SlotFailure = "dm_closed" | "discord_unavailable" | "outcome_unknown";
export type SlotLease = { id: string; lease_token: string; lease_until: string };
export type SlotDelivery = SlotLease & { discord_user_id: string; subject: string; body: string; reference: string };
export interface SlotApi {
  claim(worker: string): Promise<SlotDelivery | null>;
  dispatch(worker: string, lease: SlotLease): Promise<void>;
  sent(worker: string, lease: SlotLease, messageId: string): Promise<void>;
  fail(worker: string, lease: SlotLease, code: SlotFailure): Promise<void>;
}
export function validLease(value: unknown): value is SlotLease {
  const d = value as SlotLease | null;
  return Boolean(d && typeof d.id === "string" && uuid.test(d.id) && typeof d.lease_token === "string"
    && uuid.test(d.lease_token) && typeof d.lease_until === "string" && Number.isFinite(Date.parse(d.lease_until)));
}
export function createSlotApi(config: { apiUrl: string; apiKey: string; guildId: string }, fetcher: typeof fetch = fetch, timeoutMs = 8000): SlotApi {
  const request = createTransport(config, fetcher, timeoutMs);
  async function post(op: string, worker: string, lease?: SlotLease, extra: Record<string, string> = {}) {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(worker) || (lease && !validLease(lease))) throw new ApiError("invalid_fields", 400);
    const body = { worker_id: worker, ...(lease ? { id: lease.id, lease_token: lease.lease_token } : {}), ...extra };
    if (Buffer.byteLength(JSON.stringify({ ...body, guild_id: config.guildId })) > 8192) throw new ApiError("body_too_large", 413);
    return request(`slot-messages/${op}`, {}, body);
  }
  async function ack(op: string, worker: string, lease: SlotLease, extra?: Record<string, string>) {
    if ((await post(op, worker, lease, extra)).ok !== true) throw new ApiError("invalid_response", 502);
  }
  return {
    async claim(worker) {
      const b = await post("claim", worker);
      if (b.delivery === null) return null;
      const d = b.delivery as SlotDelivery;
      if (!validLease(d) || typeof d.discord_user_id !== "string" || !snowflake.test(d.discord_user_id)
        || typeof d.subject !== "string" || !d.subject.trim() || typeof d.body !== "string" || !d.body.trim()
        || d.reference !== `BESC-SLOT-${d.id}`) throw new ApiError("invalid_response", 502);
      return { id: d.id, lease_token: d.lease_token, lease_until: d.lease_until,
        discord_user_id: d.discord_user_id, subject: d.subject, body: d.body, reference: d.reference };
    },
    dispatch: (worker, lease) => ack("dispatch", worker, lease),
    async sent(worker, lease, messageId) {
      if (!snowflake.test(messageId)) throw new ApiError("invalid_fields", 400);
      return ack("sent", worker, lease, { message_id: messageId });
    },
    async fail(worker, lease, code) {
      if (!["dm_closed", "discord_unavailable", "outcome_unknown"].includes(code)) throw new ApiError("invalid_fields", 400);
      return ack("fail", worker, lease, { error_code: code });
    },
  };
}
