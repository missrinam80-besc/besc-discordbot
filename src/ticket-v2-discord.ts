import { ChannelType, PermissionFlagsBits, type Client, type TextChannel, type Message, type MessageCreateOptions } from "discord.js";
import { ConfigFailure, type ConfigEffects } from "./ticket-v2-worker.ts";
import { type ConfigDelivery, type TypeRevision, type TicketEmbed } from "./ticket-v2-schema.ts";
import type { V2State } from "./ticket-v2-state.ts";
export const permissionChecks = [
  ["view_channel", PermissionFlagsBits.ViewChannel], ["send_messages", PermissionFlagsBits.SendMessages],
  ["create_private_threads", PermissionFlagsBits.CreatePrivateThreads], ["send_messages_in_threads", PermissionFlagsBits.SendMessagesInThreads],
  ["read_message_history", PermissionFlagsBits.ReadMessageHistory], ["manage_threads", PermissionFlagsBits.ManageThreads], ["embed_links", PermissionFlagsBits.EmbedLinks],
] as const;
export const panelCustomId = (panel: string, revision: string) => `besc:v2:p:${panel}:${revision}`;
export function discordEmbed(e: TicketEmbed) { return { title: e.title, description: e.description, color: parseInt(e.color.slice(1), 16), ...(e.footer ? { footer: { text: e.footer } } : {}) }; }
export function panelOptions(d: ConfigDelivery): MessageCreateOptions {
  const types = d.payload.typeRevisions as TypeRevision[];
  return { embeds: [discordEmbed(d.payload.embed as TicketEmbed)], components: [{ type: 1, components: [{ type: 3,
    custom_id: panelCustomId(d.panelId!, d.revisionId!), placeholder: "Kies een tickettype", min_values: 1, max_values: 1,
    options: types.map(t => ({ label: t.name, value: t.revisionId, ...(t.description ? { description: t.description } : {}) })) }] }],
    nonce: d.nonce, enforceNonce: true, allowedMentions: { parse: [] } };
}
function rows(message: Message) { return message.components.map(c => c.toJSON()); }
function marked(message: Message, panel: string) {
  return rows(message).some(row => "components" in row && row.components.some(c => "custom_id" in c && typeof c.custom_id === "string" && c.custom_id.startsWith(`besc:v2:p:${panel}:`)));
}
function samePublication(message: Message, d: ConfigDelivery) {
  const payload = panelOptions(d);
  const normalize = (input: unknown) => {
    const row = input as { type: number; components?: { type: number; custom_id?: string; disabled?: boolean; placeholder?: string; min_values?: number; max_values?: number; options?: unknown }[] };
    return { type: row.type, components: row.components?.map(c => ({ type: c.type, custom_id: c.custom_id, disabled: c.disabled ?? false,
      placeholder: c.placeholder, min_values: c.min_values ?? 1, max_values: c.max_values ?? 1,
      options: Array.isArray(c.options) ? c.options.map((o: { label?: string; value?: string; description?: string; emoji?: unknown; default?: boolean }) => ({ label: o.label, value: o.value,
        ...(o.description ? { description: o.description } : {}), ...(o.emoji ? { emoji: o.emoji } : {}), ...(o.default ? { default: o.default } : {}) })) : c.options })) };
  };
  return !message.content && message.embeds.every(e => !e.image && !e.thumbnail && !e.url && !e.author && !e.fields?.length)
    && JSON.stringify(message.embeds.map(e => ({ title: e.title, description: e.description, color: e.color, ...(e.footer?.text ? { footer: { text: e.footer.text } } : {}) }))) === JSON.stringify(payload.embeds)
    && JSON.stringify(rows(message).map(normalize)) === JSON.stringify((payload.components as unknown[]).map(normalize));
}
export class DiscordConfigEffects implements ConfigEffects {
  client: Client; guild: string; app: string; state: V2State;
  constructor(client: Client, guild: string, app: string, state: V2State) { this.client = client; this.guild = guild; this.app = app; this.state = state; }
  async channel(id: string): Promise<TextChannel> {
    const c = await this.client.channels.fetch(id, { force: true });
    if (!c || c.type !== ChannelType.GuildText || c.guildId !== this.guild) throw new ConfigFailure("permission_denied", false);
    return c;
  }
  async confirmed(d: ConfigDelivery) { await this.state.forget?.(d.id); }
  async report() {
    const guild = await this.client.guilds.fetch(this.guild); const channels = await guild.channels.fetch();
    return [...channels.values()].filter((c): c is TextChannel => Boolean(c && c.type === ChannelType.GuildText && c.guildId === this.guild))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 50).map(c => ({ id: c.id, name: c.name, type: 0 as const }));
  }
  private binding(message: Message, channel: TextChannel, d: ConfigDelivery) {
    if (message.guildId !== this.guild || message.channelId !== channel.id || message.author.id !== this.app || !d.panelId || !marked(message, d.panelId)) throw new ConfigFailure("outcome_unknown");
  }
  private async find(channel: TextChannel, d: ConfigDelivery): Promise<Message | null> {
    const journal = this.state.effect(d.id);
    if (journal && (journal.guild !== this.guild || journal.channel !== channel.id || journal.payloadHash !== d.payloadHash || journal.marker !== d.marker)) throw new ConfigFailure("outcome_unknown");
    const matches = new Map<string, Message>(); let before: string | undefined; let done = false;
    // Bound complete history search. A partial scan is never evidence of absence.
    for (let page = 0; page < 50; page++) {
      if (Date.parse(d.leasedUntil) - Date.now() < 20000) throw new ConfigFailure("outcome_unknown");
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      for (const m of batch.values()) if (m.author.id === this.app && marked(m, d.panelId!)) matches.set(m.id, m);
      if (batch.size < 100) { done = true; break; }
      before = batch.last()?.id;
    }
    if (!done) throw new ConfigFailure("outcome_unknown");
    if (matches.size > 1) throw new ConfigFailure("duplicate_marker");
    const known = d.messageId ?? journal?.message;
    if (known) {
      const message = await channel.messages.fetch(known).catch((e: unknown) => {
        if (typeof e === "object" && e && "code" in e && e.code === 10008) return null;
        throw e;
      });
      if (!message) { if (matches.size) throw new ConfigFailure("duplicate_marker"); return null; }
      this.binding(message, channel, d);
      if (matches.size && [...matches.keys()][0] !== message.id) throw new ConfigFailure("duplicate_marker");
      return message;
    }
    const message = matches.values().next().value as Message | undefined;
    if (message) this.binding(message, channel, d);
    return message ?? null;
  }
  async execute(d: ConfigDelivery, inspect: () => Promise<ConfigDelivery>): Promise<Record<string, unknown>> {
    if (d.guildId !== this.guild || this.client.user?.id !== this.app || this.client.application?.id !== this.app) throw new ConfigFailure("permission_denied", false);
    if (d.kind === "verify_server_admin") {
      const guild = await this.client.guilds.fetch(this.guild);
      const user = String(d.payload.discordUserId);
      const member = await guild.members.fetch({ user, force: true }).catch((e: unknown) => {
        if (typeof e === "object" && e && "code" in e && e.code === 10007) return null;
        throw e;
      });
      await inspect();
      return { discord_user_id: user, is_admin: Boolean(member && !member.user.bot && member.permissions.has(PermissionFlagsBits.ManageGuild)) };
    }
    const channel = await this.channel(d.channelId!);
    const permissions = channel.permissionsFor(this.client.user!);
    if (d.kind === "check_channel") {
      const missing = permissionChecks.filter(([, bit]) => !permissions?.has(bit)).map(([name]) => name);
      await inspect(); return { channel_id: channel.id, channel_type: 0, permissions_ok: missing.length === 0, missing_permissions: missing };
    }
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new ConfigFailure("permission_denied", false);
    let message = await this.find(channel, d);
    const result = { channel_id: channel.id, bot_author_id: this.app, ...(d.kind === "publish_panel" ? { revision_id: d.revisionId } : {}) };
    if (d.kind === "disable_panel") {
      if (!message) return { ...result, message_id: d.messageId, disabled: true };
      const alreadyDisabled = rows(message).every(row => !("components" in row) || row.components.every(c => !("custom_id" in c) || "disabled" in c && c.disabled));
      if (!alreadyDisabled) {
        await inspect();
        const components = rows(message).map(row => "components" in row ? { ...row, components: row.components.map(c => "custom_id" in c ? { ...c, disabled: true } : c) } : row);
        await message.edit({ components, allowedMentions: { parse: [] } });
      }
      return { ...result, message_id: message.id, disabled: true };
    }
    // A matching effect after a crash can be acknowledged even when intake was withdrawn meanwhile.
    if (message && samePublication(message, d)) return { ...result, message_id: message.id };
    const current = await inspect();
    if (current.withdrawn) return { ...result, ...(d.messageId ? { message_id: d.messageId, skipped: true } : message ? { skipped: true } : { message_absent: true }) };
    if (!message && d.messageId) throw new ConfigFailure("message_missing", false);
    if (!message && d.reconcile) throw new ConfigFailure("outcome_unknown");
    const payload = panelOptions(d);
    // All reads are finished. Reinspect immediately before this one Discord effect.
    if ((await inspect()).withdrawn) return { ...result, ...(d.messageId ? { message_id: d.messageId, skipped: true } : { message_absent: true }) };
    if (message) message = await message.edit({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } });
    else message = await channel.send(payload);
    await this.state.remember(d.id, { guild: this.guild, channel: channel.id, message: message.id, payloadHash: d.payloadHash, marker: d.marker });
    return { ...result, message_id: message.id };
  }
}
