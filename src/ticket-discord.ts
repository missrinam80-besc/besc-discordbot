import { ChannelType, PermissionFlagsBits, type Client, type TextChannel, type ThreadChannel } from "discord.js";
import type { Delivery, TicketApi } from "./ticket-api.ts";
import { DeliveryError, type TicketDiscord } from "./ticket-worker.ts";
const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads];
export class DiscordTickets implements TicketDiscord {
  client: Client; guildId: string; parentId: string; api: TicketApi;
  constructor(client: Client, guildId: string, parentId: string, api: TicketApi) { this.client = client; this.guildId = guildId; this.parentId = parentId; this.api = api; }
  async parent(): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(this.parentId);
    if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== this.guildId || !this.client.user
      || !channel.permissionsFor(this.client.user)?.has(needed)) throw new DeliveryError("permission_denied", false);
    return channel;
  }
  async validateRequester(user: string) {
    const parent = await this.parent();
    const member = await parent.guild.members.fetch({ user, force: true });
    if (member.user.bot || !parent.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads])) throw new DeliveryError("permission_denied", false);
    return parent;
  }
  check(thread: ThreadChannel, marker: string) {
    if (thread.type !== ChannelType.PrivateThread || thread.guildId !== this.guildId || thread.parentId !== this.parentId
      || thread.name !== marker || thread.ownerId !== this.client.user?.id || thread.invitable !== false) throw new DeliveryError("unexpected_participants");
    return thread;
  }
  async participants(thread: ThreadChannel): Promise<string[]> {
    // Complete listing requires GuildMembers. A partial listing is never proof of privacy.
    const users: string[] = []; let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ limit: "100", with_member: "true", ...(after ? { after } : {}) });
      const members = await this.client.rest.get(`/channels/${thread.id}/thread-members`, { query }) as { user_id: string }[];
      for (const m of members) if (m.user_id !== this.client.user?.id) users.push(m.user_id);
      if (members.length < 100) return users;
      after = members.at(-1)?.user_id;
    }
    throw new DeliveryError("outcome_unknown");
  }
  async threads(deadline = Date.now() + 30_000): Promise<ThreadChannel[]> {
    const parent = await this.parent();
    const found = new Map<string, ThreadChannel>();
    const active = await parent.threads.fetchActive();
    for (const t of active.threads.values()) if (t.type === ChannelType.PrivateThread) found.set(t.id, t);
    let before: string | undefined;
    for (let page = 0; page < 50; page++) {
      if (Date.now() > deadline) throw new DeliveryError("outcome_unknown");
      const archived = await parent.threads.fetchArchived({ type: "private", limit: 100, ...(before ? { before } : {}) }, false);
      for (const t of archived.threads.values()) found.set(t.id, t);
      if (!archived.hasMore) return [...found.values()];
      const last = archived.threads.last();
      if (!last?.archiveTimestamp) throw new DeliveryError("outcome_unknown");
      const next = new Date(last.archiveTimestamp).toISOString();
      if (next === before) throw new DeliveryError("outcome_unknown");
      before = next;
    }
    throw new DeliveryError("outcome_unknown");
  }
  async find(d: Delivery): Promise<ThreadChannel | null> {
    // Even a known mapping is checked for duplicate markers before writing.
    const matching = (await this.threads(Date.parse(d.leasedUntil) - 15_000)).filter(t => t.name === d.ticketMarker);
    if (matching.length > 1) throw new DeliveryError("duplicate_marker");
    if (d.threadId && matching[0]?.id !== d.threadId) {
      const mapped = await this.client.channels.fetch(d.threadId).catch((e: unknown) => {
        if (typeof e === "object" && e && "code" in e && e.code === 10003) return null;
        throw e;
      });
      if (mapped) throw new DeliveryError("unexpected_participants");
      if (matching.length) throw new DeliveryError("duplicate_marker");
    }
    return matching[0] ? this.check(matching[0], d.ticketMarker) : null;
  }
  fresh(d: Delivery) { if (Date.parse(d.leasedUntil) - Date.now() < 10_000) throw new DeliveryError("outcome_unknown"); }
  async execute(d: Delivery): Promise<Record<string, unknown>> {
    if (d.guildId !== this.guildId || d.parentChannelId !== this.parentId) throw new DeliveryError("permission_denied", false);
    let thread = await this.find(d);
    this.fresh(d);
    if (d.kind === "create_thread") {
      const requester = String(d.payload.requester_discord_id);
      const parent = await this.validateRequester(requester);
      if (!thread) {
        if (d.ticketStatus === "closed") return { thread_absent: true };
        // After uncertain creation, absence in an incomplete Discord history is not permission to repeat it.
        if (d.reconcile) throw new DeliveryError("outcome_unknown");
        this.fresh(d);
        thread = await parent.threads.create({ name: d.ticketMarker, type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 1440 });
      }
      if (thread.archived) { this.fresh(d); await thread.setArchived(false); }
      const users = await this.participants(thread);
      if (users.some(id => id !== requester)) throw new DeliveryError("unexpected_participants");
      this.fresh(d); await thread.members.add(requester);
      const verified = await this.participants(thread);
      if (verified.length !== 1 || verified[0] !== requester) throw new DeliveryError("unexpected_participants");
      return { thread_id: thread.id, parent_channel_id: this.parentId, requester_discord_id: requester, requester_added: true, invitable: false };
    }
    if (!thread) {
      if (d.kind === "delete_thread" || d.kind === "close_thread") return { ...(d.threadId ? { thread_id: d.threadId } : {}), thread_absent: true };
      throw new DeliveryError("thread_missing", false);
    }
    if (d.kind === "delete_thread") { this.fresh(d); await thread.delete(); return { thread_id: thread.id }; }
    const users = await this.participants(thread);
    if (users.length !== 1) throw new DeliveryError("unexpected_participants");
    if (!d.ticketId || (await this.api.own(d.ticketId, users[0])).threadId !== thread.id) throw new DeliveryError("unexpected_participants");
    if (d.kind === "close_thread") {
      this.fresh(d); await thread.edit({ locked: true, archived: true });
      return { thread_id: thread.id };
    }
    // Nonce lookup is required before every send, including retries after lost completion responses.
    let before: string | undefined;
    for (let page = 0; page < 50; page++) {
      this.fresh(d);
      const messages = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      const prior = messages.find(m => m.author.id === this.client.user?.id && String(m.nonce) === d.nonce);
      if (prior) {
        if (prior.embeds[0]?.description !== d.payload.content) throw new DeliveryError("outcome_unknown");
        return { thread_id: thread.id, message_id: prior.id };
      }
      if (messages.size < 100) break;
      if (page === 49) throw new DeliveryError("outcome_unknown");
      before = messages.last()?.id;
    }
    if (d.reconcile) throw new DeliveryError("outcome_unknown");
    this.fresh(d);
    if (thread.archived) await thread.setArchived(false);
    // Embeds support the CC contract's 4000 characters without splitting one delivery into several effects.
    this.fresh(d);
    const sent = await thread.send({ embeds: [{ description: String(d.payload.content) }], nonce: d.nonce, enforceNonce: true, allowedMentions: { parse: [] } });
    return { thread_id: thread.id, message_id: sent.id };
  }
}
