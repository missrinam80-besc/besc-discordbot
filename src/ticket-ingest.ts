import { ChannelType, type Message } from "discord.js";
import { ApiError } from "./api.ts";
import type { DiscordTickets } from "./ticket-discord.ts";
import { uuid, type TicketApi } from "./ticket-api.ts";
export function createTicketIngest(api: TicketApi, discord: DiscordTickets, log: (code: string) => void) {
  const cursors = new Map<string, string>(); let running = false; let rotation = 0;
  async function message(m: Message) {
    if (m.author.bot || m.webhookId || m.guildId !== discord.guildId || m.channel.type !== ChannelType.PrivateThread
      || m.channel.parentId !== discord.parentId || !m.channel.name.startsWith("besc-ticket-")) return;
    const id = m.channel.name.slice("besc-ticket-".length);
    if (!uuid.test(id)) return;
    discord.check(m.channel, m.channel.name);
    const users = await discord.participants(m.channel);
    if (users.length !== 1 || users[0] !== m.author.id) { log("ticket_unexpected_participants"); return; }
    await discord.validateRequester(m.author.id);
    const own = await api.own(id, m.author.id);
    if (own.threadId !== m.channel.id || own.status === "closed") return;
    if (!m.content.trim()) { log("ticket_empty_or_attachment_not_imported"); return; }
    await api.ingest(id, m.author.id, m.channel.id, m.id, m.content);
  }
  async function sync() {
    if (running) return; running = true;
    try {
      const threads = (await discord.threads()).filter(t => t.name.startsWith("besc-ticket-") && uuid.test(t.name.slice(12)));
      if (!threads.length) return;
      // Fair rotation; bounded work stays inside the API-client's rate budget.
      const selected = Array.from({ length: Math.min(3, threads.length) }, (_, n) => threads[(rotation + n) % threads.length]);
      rotation = (rotation + selected.length) % threads.length;
      for (const thread of selected) {
        try {
          discord.check(thread, thread.name);
          const users = await discord.participants(thread);
          if (users.length !== 1) { log("ticket_unexpected_participants"); continue; }
          await discord.validateRequester(users[0]);
          const own = await api.own(thread.name.slice(12), users[0]);
          if (own.threadId !== thread.id || own.status === "closed") continue;
          const cursor = cursors.get(thread.id);
          const pending: Message[] = []; let before: string | undefined; let finished = false;
          for (let page = 0; page < 50; page++) {
            const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
            for (const m of batch.values()) if (!cursor || BigInt(m.id) > BigInt(cursor)) pending.push(m);
            if (batch.size < 100 || cursor && [...batch.keys()].some(id => BigInt(id) <= BigInt(cursor))) { finished = true; break; }
            before = batch.last()?.id;
          }
          if (!finished) { log("ticket_history_limit_requires_recovery"); continue; }
          pending.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
          let imported = 0;
          for (const m of pending) {
            if (!m.author.bot && !m.webhookId) {
              if (m.author.id !== users[0]) { log("ticket_unexpected_participants"); break; }
              if (m.content.trim()) { if (imported >= 8) break; await api.ingest(own.ticketId, m.author.id, thread.id, m.id, m.content); imported++; }
              else log("ticket_empty_or_attachment_not_imported");
            }
            cursors.set(thread.id, m.id);
          }
        } catch (e) { log(e instanceof ApiError && e.code === "rate_limited" ? "ticket_sync_rate_limited" : "ticket_sync_unavailable"); }
      }
    } catch { log("ticket_history_unavailable"); }
    finally { running = false; }
  }
  return { async message(m: Message) { try { await message(m); } catch { log("ticket_ingest_pending_recovery"); } }, sync };
}
