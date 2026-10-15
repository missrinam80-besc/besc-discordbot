import { createHash } from "node:crypto";
import { snowflake, type SlotDelivery, type SlotFailure } from "./slot-api.ts";

export class SlotSendError extends Error {
  readonly code: SlotFailure;
  constructor(code: SlotFailure) { super(code); this.code = code; }
}
export function slotPayload(d: SlotDelivery) {
  // One message, no truncation, no split sends: a partial multi-message send cannot be acknowledged safely.
  if (!d.subject.trim() || !d.body.trim() || d.subject.length > 256 || d.body.length > 4096
    || d.reference !== `BESC-SLOT-${d.id}` || d.subject.length + d.body.length + d.reference.length > 6000) {
    throw new SlotSendError("discord_unavailable");
  }
  return { embeds: [{ title: d.subject, description: d.body, footer: { text: d.reference } }],
    allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
    nonce: createHash("sha256").update(d.id).digest("hex").slice(0, 24), enforce_nonce: true };
}
export interface SlotDiscord { send(delivery: SlotDelivery): Promise<string>; }
/** Dedicated HTTP sender: no library retries, redirects, rate-limit sleeps, or shared REST queue. */
export function createSlotDiscord(token: string, fetcher: typeof fetch = fetch, timeoutMs = 20_000, now = Date.now): SlotDiscord {
  return { async send(d) {
    const payload = slotPayload(d);
    const controller = new AbortController();
    const remaining = Math.min(timeoutMs, Date.parse(d.lease_until) - now() - 10_000);
    if (remaining <= 0) throw new SlotSendError("discord_unavailable");
    const timer = setTimeout(() => controller.abort(), remaining);
    async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
      const response = await fetcher(`https://discord.com/api/v10/${path}`, { method: "POST", redirect: "error",
        signal: controller.signal, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json",
          "User-Agent": "DiscordBot (https://github.com/missrinam80-besc/besc-discordbot, 0.1.0)" }, body: JSON.stringify(body) });
      const reader = response.body?.getReader();
      if (!reader) throw new SlotSendError("outcome_unknown");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > 65_536) throw new SlotSendError("outcome_unknown"); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new SlotSendError("outcome_unknown");
      const data = value as Record<string, unknown>;
      // 50007 with a real 403 is the documented refusal; a timeout/429/5xx is never evidence of closed DMs.
      if (!response.ok) throw new SlotSendError(response.status === 403 && data.code === 50007 ? "dm_closed" : "discord_unavailable");
      return data;
    }
    try {
      const dm = await post("users/@me/channels", { recipient_id: d.discord_user_id });
      if (dm.type !== 1 || typeof dm.id !== "string" || !snowflake.test(dm.id)
        || !Array.isArray(dm.recipients) || dm.recipients.length !== 1 || dm.recipients[0]?.id !== d.discord_user_id) {
        throw new SlotSendError("outcome_unknown");
      }
      if (controller.signal.aborted || Date.parse(d.lease_until) - now() <= 10_000) throw new SlotSendError("discord_unavailable");
      const message = await post(`channels/${dm.id}/messages`, payload);
      if (typeof message.id !== "string" || !snowflake.test(message.id) || message.channel_id !== dm.id) throw new SlotSendError("outcome_unknown");
      return message.id;
    } catch (e) { throw e instanceof SlotSendError ? e : new SlotSendError("outcome_unknown"); }
    finally { clearTimeout(timer); }
  } };
}
