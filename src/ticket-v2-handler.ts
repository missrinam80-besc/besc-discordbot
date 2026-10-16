import { ComponentType, DiscordAPIError, MessageFlags, ModalBuilder, type InteractionReplyOptions, type ChatInputCommandInteraction, type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction } from "discord.js";
import { ApiError } from "./api.ts";
import type { V2Api, IntentSource } from "./ticket-v2-api.ts";
import { uuid } from "./ticket-api.ts";
import { features, answersFor, type TypeRevision, type TicketConfig } from "./ticket-v2-schema.ts";
import { discordEmbed, panelCustomId } from "./ticket-v2-discord.ts";
export type V2Interaction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
type CachedForm = { actor: string; revision: TypeRevision; expires: number };
// Never log Discord exceptions: their URL and request body contain interaction tokens and answers.
export function safeV2Diagnostic(error: unknown, openingModal: boolean): string[] {
  const prefix = openingModal ? "typed_show_modal" : "typed_interaction";
  if (error instanceof DiscordAPIError) {
    const code = [10062, 40060, 50001, 50013, 50035].includes(Number(error.code)) ? String(Number(error.code)) : "other";
    const result = [`${prefix}_discord_${code}`];
    if (code === "50035") {
      const allowed = new Set(["data", "custom_id", "title", "components", "component", "type", "label", "description", "style", "required", "min_length", "max_length", "placeholder", "options", "value", "min_values", "max_values"]);
      const walk = (value: unknown, path: string[], depth: number) => {
        if (!value || typeof value !== "object" || depth > 10 || result.length >= 11) return;
        if (Object.hasOwn(value, "_errors") && path.length) result.push(`${prefix}_field_${path.join(".")}`);
        for (const [key, child] of Object.entries(value)) {
          if (allowed.has(key) || /^(?:[0-9]|1[0-9]|2[0-4])$/.test(key)) walk(child, [...path, key], depth + 1);
        }
      };
      if ("errors" in error.rawError) walk(error.rawError.errors, [], 0);
    }
    return result;
  }
  if (error instanceof ApiError) {
    const code = ["invalid_config", "invalid_response", "api_timeout", "api_unavailable", "upstream_unavailable", "intent_expired", "intent_unavailable", "revision_unavailable", "source_not_allowed", "intake_unavailable", "intent_consumed", "linked_account_required", "invalid_answers", "rate_limited"].includes(error.code) ? error.code : "other";
    return [`${prefix}_api_${code}`];
  }
  return [`${prefix}_unexpected`];
}
export function modalFor(t: TypeRevision, intent: string) {
  return ModalBuilder.from({ custom_id: `besc:v2:m:${intent}:${t.revisionId}`, title: t.formTitle, components: t.questions.map(q => ({
    type: 18 as const, label: q.label, ...(q.description ? { description: q.description } : {}),
    component: "minLength" in q ? {
      type: 4 as const, custom_id: q.id, style: q.kind === "short" ? 1 as const : 2 as const, required: q.required,
      min_length: q.minLength, max_length: q.maxLength, ...(q.placeholder ? { placeholder: q.placeholder } : {}),
    } : { type: 3 as const, custom_id: q.id, required: q.required, min_values: q.required ? 1 : 0, max_values: q.maxValues,
      options: q.options, ...(q.placeholder ? { placeholder: q.placeholder } : {}) },
  })) });
}
const v2Error = (e: unknown) => e instanceof ApiError && ["intent_expired", "intent_unavailable", "revision_unavailable", "source_not_allowed", "intake_unavailable", "intent_consumed", "linked_account_required", "invalid_answers"].includes(e.code)
  ? ({ intent_expired: "Dit formulier is verlopen. Begin opnieuw bij het ticketpaneel.", intent_consumed: "Dit formulier is al verwerkt. Gebruik de ontvangen ticketreferentie.", linked_account_required: "Voor dit tickettype heb je een actueel gekoppeld BESC-account nodig.", invalid_answers: "Controleer de verplichte antwoorden en toegestane keuzes." } as Record<string, string>)[e.code] ?? "Dit tickettype of paneel is niet meer beschikbaar. Begin opnieuw."
  : "Ticketing is tijdelijk niet beschikbaar. Probeer later opnieuw; er wordt geen leeg ticket gemaakt.";
export function createV2Handler(api: V2Api, guild: string, app: string, validateRequester: (actor: string, parent: string) => Promise<unknown>,
  log: (code: string) => void, now: () => number = Date.now) {
  const forms = new Map<string, CachedForm>();
  const cache = (intent: string, form: CachedForm) => {
    for (const [id, f] of forms) if (f.expires <= now()) forms.delete(id);
    if (forms.size >= 1000 && !forms.has(intent)) throw new ApiError("rate_limited", 429);
    forms.set(intent, form);
  };
  const button = (intent: string, revision: string) => [{ type: 1 as const, components: [{ type: 2 as const, style: 1 as const,
    custom_id: `besc:v2:f:${intent}:${revision}`, label: "Formulier invullen" }] }];
  function list(config: TicketConfig, page = 0) {
    const sorted = [...config.typeRevisions].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    if (!features.every(f => config.features.includes(f)) || !sorted.length) return { content: "Er zijn momenteel geen gepubliceerde tickettypes beschikbaar.", components: [], embeds: [] };
    const max = Math.ceil(sorted.length / 25) - 1; page = Math.max(0, Math.min(max, page));
    return { content: "Kies het soort ticket. Je ontvangt daarna uitleg en een privéformulier.", embeds: [], components: [
      { type: 1 as const, components: [{ type: 3 as const, custom_id: "besc:v2:choose", placeholder: "Kies een tickettype", options: sorted.slice(page * 25, page * 25 + 25).map(t => ({ label: t.name, value: t.revisionId, ...(t.description ? { description: t.description } : {}) })) }] },
      ...(max ? [{ type: 1 as const, components: [{ type: 2 as const, style: 2 as const, custom_id: `besc:v2:list:${page - 1}`, label: "Vorige", disabled: page === 0 },
        { type: 2 as const, style: 2 as const, custom_id: `besc:v2:list:${page + 1}`, label: "Volgende", disabled: page === max }] }] : []),
    ] };
  }
  return async (i: V2Interaction): Promise<boolean> => {
    const slash = i.isChatInputCommand() && i.commandName === "besc" && i.options.getSubcommandGroup(false) === "ticket" && i.options.getSubcommand() === "openen";
    if (!slash && (i.isChatInputCommand() || !i.customId.startsWith("besc:v2:"))) return false;
    let openingModal = false;
    let selectionReply = false;
    const respond = (data: Pick<InteractionReplyOptions, "content" | "embeds" | "components" | "allowedMentions">) => selectionReply
      ? i.followUp({ ...data, flags: MessageFlags.Ephemeral }) : i.editReply(data);
    try {
      if (i.guildId !== guild) { await i.reply({ content: "Dit ticket werkt alleen op de ingestelde server.", flags: MessageFlags.Ephemeral }); return true; }
      if (!i.isChatInputCommand() && !i.isModalSubmit() && i.message.author.id !== app) {
        await i.reply({ content: "Dit is geen geldig BESC-ticketpaneel.", flags: MessageFlags.Ephemeral }); return true;
      }
      if (i.isButton() && i.customId.startsWith("besc:v2:f:")) {
        const [intent, revision] = i.customId.slice(10).split(":");
        if (!uuid.test(intent ?? "") || !uuid.test(revision ?? "")) throw new ApiError("invalid_config", 400);
        const saved = forms.get(intent);
        if (saved && (saved.actor !== i.user.id || saved.revision.revisionId !== revision)) throw new ApiError("intent_unavailable", 404);
        if (saved && saved.expires <= now()) { forms.delete(intent); throw new ApiError("intent_expired", 410); }
        if (saved && saved.actor === i.user.id && saved.revision.revisionId === revision && saved.expires > now()) {
          // No network or defer before showModal: preserve Discord's initial response deadline.
          openingModal = true;
          await i.showModal(modalFor(saved.revision, intent)); return true;
        }
        await i.deferUpdate();
        const t = await api.revision(revision);
        cache(intent, { actor: i.user.id, revision: t, expires: now() + 30 * 60000 });
        await i.editReply({ content: "Het formulier is opnieuw geladen. Klik nogmaals om het te openen.", embeds: [discordEmbed(t.embed)], components: button(intent, revision), allowedMentions: { parse: [] } });
        return true;
      }
      if (i.isModalSubmit()) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const [intent, revision] = i.customId.slice(10).split(":");
        if (!i.customId.startsWith("besc:v2:m:") || !uuid.test(intent ?? "") || !uuid.test(revision ?? "")) throw new ApiError("invalid_config", 400);
        // A CC-authorized old revision survives local cache loss; never replace it with the newest form.
        const cached = forms.get(intent);
        if (cached && (cached.actor !== i.user.id || cached.revision.revisionId !== revision)) throw new ApiError("intent_unavailable", 404);
        const t = cached?.revision ?? await api.revision(revision);
        await validateRequester(i.user.id, t.parentChannelId);
        const input: Record<string, unknown> = Object.create(null);
        if ([...i.fields.fields.keys()].some(id => !t.questions.some(q => q.id === id))) throw new ApiError("invalid_answers", 400);
        for (const q of t.questions) {
          if (!i.fields.fields.has(q.id)) { if (q.required) throw new ApiError("invalid_answers", 400); continue; }
          input[q.id] = q.kind === "short" || q.kind === "paragraph" ? i.fields.getTextInputValue(q.id) : i.fields.getStringSelectValues(q.id);
        }
        const ticket = await api.intake(i.user.id, revision, intent, answersFor(t, input), i.id);
        forms.delete(intent);
        await i.editReply({ content: `Ticket geregistreerd: \`${ticket.ticketId}\`. De privéthread wordt aangemaakt.\nGebruik \`/besc ticket bekijken nummer:${ticket.ticketId}\` voor de threadlink.\nBijlagen en latere berichtwijzigingen worden niet overgenomen.`, components: [], embeds: [], allowedMentions: { parse: [] } });
        return true;
      }
      if (i.isStringSelectMenu()) {
        // Acknowledge the source menu, then send all explanations/errors privately.
        // A deferred private reply alone leaves Discord's selected option checked.
        await i.deferUpdate();
        selectionReply = true;
        const panelIds = i.customId.slice("besc:v2:p:".length).split(":");
        const privateList = i.customId === "besc:v2:choose" && Boolean(i.message.flags.bitfield & MessageFlags.Ephemeral);
        if (!privateList && !(i.customId.startsWith("besc:v2:p:") && panelIds.length === 2 && panelIds.every(id => uuid.test(id)))) throw new ApiError("source_not_allowed", 403);
        // Fetch shared panels afresh: never restore a superseded or disabled menu
        // from the interaction's older message snapshot.
        const message = privateList ? i.message : await i.message.fetch(true);
        if (message.id !== i.message.id || message.author.id !== app || message.channelId !== i.channelId || message.guildId !== guild) throw new ApiError("source_not_allowed", 403);
        const rows = message.components.map(row => row.toJSON());
        const menu = rows.flatMap(row => row.type === ComponentType.ActionRow ? row.components : [])
          .find(c => c.type === ComponentType.StringSelect && c.custom_id === i.customId);
        if (!menu || menu.type !== ComponentType.StringSelect) throw new ApiError("source_not_allowed", 403);
        if (menu.disabled) throw new ApiError("intake_unavailable", 409);
        await i.editReply({ components: rows.map(row => row.type === ComponentType.ActionRow ? { ...row, components: row.components.map(c =>
          c.type === ComponentType.StringSelect && c.custom_id === i.customId ? { ...c, options: c.options.map(option => ({ ...option, default: false })) } : c) } : row), allowedMentions: { parse: [] } });
      } else await i.deferReply({ flags: MessageFlags.Ephemeral });
      const config = await api.config();
      if (slash || i.isButton() && /^besc:v2:list:-?\d{1,4}$/.test(i.customId)) {
        const page = i.isButton() ? Number(i.customId.split(":").at(-1)) : 0;
        await i.editReply({ ...list(config, page), allowedMentions: { parse: [] } }); return true;
      }
      if (!i.isStringSelectMenu() || i.values.length !== 1 || !uuid.test(i.values[0])) throw new ApiError("invalid_config", 400);
      const t = config.typeRevisions.find(t => t.revisionId === i.values[0]);
      if (!t || !features.every(f => config.features.includes(f))) throw new ApiError("revision_unavailable", 410);
      let source: IntentSource = { source: "slash" };
      if (i.customId !== "besc:v2:choose") {
        const panel = config.panels.find(p => panelCustomId(p.panelId, p.revisionId) === i.customId && p.channelId === i.channelId && p.messageId === i.message.id && p.typeRevisionIds.includes(t.revisionId));
        if (!panel) throw new ApiError("source_not_allowed", 403);
        source = { source: "panel", panel_id: panel.panelId, panel_revision_id: panel.revisionId, channel_id: panel.channelId, message_id: panel.messageId };
      } else if (!(i.message.flags.bitfield & MessageFlags.Ephemeral)) throw new ApiError("source_not_allowed", 403);
      await validateRequester(i.user.id, t.parentChannelId);
      const intent = await api.intent(i.user.id, t.revisionId, source, i.id);
      const immutable = await api.revision(intent.typeRevisionId);
      cache(intent.intentId, { actor: i.user.id, revision: immutable, expires: Date.parse(intent.expiresAt) });
      await respond({ content: "Lees de uitleg en vul daarna het formulier in.", embeds: [discordEmbed(immutable.embed)], components: button(intent.intentId, immutable.revisionId), allowedMentions: { parse: [] } });
    } catch (e) {
      for (const code of safeV2Diagnostic(e, openingModal)) log(code);
      try {
        const content = v2Error(e);
        if (i.deferred || i.replied) await respond({ content, embeds: [], components: [], allowedMentions: { parse: [] } });
        else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      } catch { log("typed_interaction_unavailable"); }
    }
    return true;
  };
}
