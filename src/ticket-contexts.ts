import { ChannelType, type Client, type Message } from "discord.js";
import { createTicketApi, uuid, type Delivery } from "./ticket-api.ts";
import { DiscordTickets } from "./ticket-discord.ts";
import { createTicketIngest } from "./ticket-ingest.ts";
import type { V2State } from "./ticket-v2-state.ts";
export function createTicketContexts(client: Client, config: { apiUrl: string; apiKey: string; guildId: string; ticketParentChannelId: string; storedParentBindings?: boolean }, log: (code: string) => void, state?: V2State, fetcher: typeof fetch = fetch) {
  const contexts = new Map<string, { discord: DiscordTickets; ingest: ReturnType<typeof createTicketIngest> }>(); let rotation = 0;
  const known = new Set([config.ticketParentChannelId, ...(state?.parents() ?? [])]);
  const context = (parent: string) => {
    if (!known.has(parent)) throw Error("unknown_ticket_parent");
    let c = contexts.get(parent);
    if (!c) { const api = createTicketApi({ ...config, ticketParentChannelId: parent }, fetcher); const discord = new DiscordTickets(client, config.guildId, parent, api);
      c = { discord, ingest: createTicketIngest(api, discord, log) }; contexts.set(parent, c); }
    return c;
  };
  const remember = async (parent: string) => { if (!state && !config.storedParentBindings && parent !== config.ticketParentChannelId) throw Error("unknown_ticket_parent"); if (state) await state.parent(parent); known.add(parent); };
  return {
    legacy: context(config.ticketParentChannelId).discord,
    remember,
    async validateRequester(actor: string, parent: string) { await remember(parent); return context(parent).discord.validateRequester(actor); },
    async execute(d: Delivery) { if (d.guildId !== config.guildId) throw Error("wrong_ticket_guild"); await remember(d.parentChannelId); return context(d.parentChannelId).discord.execute(d); },
    async message(m: Message) {
      try {
        if (m.author.bot || m.webhookId || m.guildId !== config.guildId || m.channel.type !== ChannelType.PrivateThread || !m.channel.parentId) return;
        if (!known.has(m.channel.parentId)) {
          // Learn a historical parent only from a live bot-owned thread whose exact ID CC confirms.
          // This is not a guild-wide history scan or authorization by a name alone.
          if (!config.storedParentBindings || m.channel.ownerId !== client.user?.id || !m.channel.name.startsWith("besc-ticket-") || !uuid.test(m.channel.name.slice(12))) return;
          const probe = createTicketApi(config, fetcher);
          const own = await probe.own(m.channel.name.slice(12), m.author.id);
          if (own.threadId !== m.channel.id) return;
          await remember(m.channel.parentId);
        }
        return context(m.channel.parentId).ingest.message(m);
      } catch { log("ticket_ingest_pending_recovery"); }
    },
    async sync() {
      const parents = [...known];
      // Old parents remain known after config edits and across restarts. No guild-wide message scan.
      const selected = Array.from({ length: Math.min(3, parents.length) }, (_, n) => parents[(rotation + n) % parents.length]);
      rotation = (rotation + selected.length) % parents.length;
      for (const parent of selected) await context(parent).ingest.sync();
    },
  };
}
