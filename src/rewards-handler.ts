import { randomUUID } from "node:crypto";
import { MessageFlags, escapeMarkdown, type ChatInputCommandInteraction, type ButtonInteraction, type StringSelectMenuInteraction, type InteractionReplyOptions } from "discord.js";
import { ApiError } from "./api.ts";
import { errorMessage, InteractionDeduplicator } from "./handler.ts";
import type { RewardsApi, RewardItem, RewardRequest, RewardJob } from "./rewards-api.ts";
import type { RewardsWorker } from "./rewards-worker.ts";

export type RewardsInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;
type Payload = Pick<InteractionReplyOptions, "content" | "components" | "embeds" | "allowedMentions">;
type Context = { actor: string; expires: number } & (
  { kind: "page"; resource: "beloningen" | "aanvragen"; offset: number } |
  { kind: "choose"; resource: "beloningen"; items: RewardItem[] } |
  { kind: "choose"; resource: "aanvragen"; items: RewardRequest[] } |
  { kind: "confirm"; operation: "request" | "cancel"; data: Record<string, unknown> }
);
const clean = (v: string, n = 1600) => escapeMarkdown(v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n)).slice(0, n).replace(/\\$/, "");
const format = (n: number) => n.toLocaleString("nl-BE");
const status: Record<string, string> = { pending: "Aangevraagd", approved: "Goedgekeurd", rejected: "Afgewezen", cancelled: "Geannuleerd", fulfilled: "Afgehandeld" };
const reasons: Record<string, string> = {
  insufficient_bucks: "Je hebt onvoldoende beschikbare Bucks. Een deel kan gereserveerd zijn voor andere aanvragen.",
  out_of_stock: "Deze beloning is niet meer op voorraad.", reward_unavailable: "Deze beloning is niet meer beschikbaar.",
  stale_version: "De beloning of aanvraag is gewijzigd. Open de actuele lijst en controleer je keuze opnieuw.",
  invalid_state: "Deze aanvraag is al behandeld en kan niet meer worden geannuleerd.",
  linked_membership_required: "Je hebt een actief BESC-lidmaatschap met actuele Discordkoppeling nodig.",
};
export function rewardError(error: unknown) {
  return error instanceof ApiError && reasons[error.code] ? reasons[error.code] : errorMessage(error);
}
export function isRewardsInteraction(i: RewardsInteraction) {
  return i.isChatInputCommand() ? i.commandName === "besc" && i.options.getSubcommandGroup(false) === "bucks" : i.customId.startsWith("besc:r:");
}
export function createRewardsHandler(api: RewardsApi, worker: RewardsWorker, guild: string, app: string,
  log: (code: string) => void = () => {}, now = Date.now) {
  const contexts = new Map<string, Context>();
  const dedupe = new InteractionDeduplicator();
  const add = (ctx: Context) => {
    for (const [key, row] of contexts) if (row.expires <= now()) contexts.delete(key);
    if (contexts.size >= 2000) throw new ApiError("rate_limited", 429);
    const id = randomUUID(); contexts.set(id, structuredClone(ctx)); return id;
  };
  const button = (label: string, id: string, style: 1 | 2 | 4 = 2) => ({ type: 2 as const, style, label, custom_id: `besc:r:${id}` });
  async function list(resource: "beloningen" | "aanvragen", actor: string, offset: number): Promise<Payload> {
    const ctx = { actor, expires: now() + 30 * 60_000 };
    const result = resource === "beloningen" ? await api.catalog(actor, offset) : await api.requests(actor, offset);
    const items = "items" in result ? result.items : result.requests;
    const components: NonNullable<Payload["components"]>[number][] = [];
    const selectable = resource === "beloningen" ? (items as RewardItem[]).filter(x => x.available_stock !== 0) : items as RewardRequest[];
    if (selectable.length) {
      const id = resource === "beloningen" ? add({ ...ctx, kind: "choose", resource, items: selectable as RewardItem[] }) : add({ ...ctx, kind: "choose", resource, items: selectable as RewardRequest[] });
      components.push({ type: 1, components: [{ type: 3, custom_id: `besc:r:${id}`, placeholder: resource === "beloningen" ? "Kies een beloning om aan te vragen" : "Kies een aanvraag om te bekijken", min_values: 1, max_values: 1,
        options: selectable.map(x => ({ label: x.title.slice(0, 100), value: x.id, description: `${format(x.price)} Bucks` })) }] });
    }
    const navigation = [];
    if (offset > 0) navigation.push(button("Vorige", add({ ...ctx, kind: "page", resource, offset: offset - 25 })));
    if (result.nextOffset !== null) navigation.push(button("Volgende", add({ ...ctx, kind: "page", resource, offset: result.nextOffset })));
    if (navigation.length) components.push({ type: 1, components: navigation });
    const lines = items.map(x => resource === "beloningen" ? `• ${clean(x.title, 40)} — ${format(x.price)} Bucks`
      : `• **${status[(x as RewardRequest).status]}** — ${clean(x.title, 26)} — ${format(x.price)} Bucks`);
    const pending = worker.outstanding(actor) ? "\nEen eerdere actie wordt nog verwerkt of vereist controle. Dien die niet opnieuw in." : "";
    return { content: `${resource === "beloningen" ? "BESC-beloningen" : "Jouw beloningsaanvragen"} · pagina ${Math.floor(offset / 25) + 1}\n${lines.join("\n") || "Nog geen items op deze pagina."}${pending}`.slice(0, 1900), components, embeds: [] };
  }
  return async (i: RewardsInteraction): Promise<boolean> => {
    if (!isRewardsInteraction(i)) return false;
    if (!dedupe.claim(i.id, now())) return true;
    try {
      if (i.guildId !== guild) { await i.reply({ content: "Dit commando werkt alleen op de ingestelde BESC-server.", flags: MessageFlags.Ephemeral }); return true; }
      if (!worker.available()) { await i.reply({ content: "BESC Bucks en XP is tijdelijk niet beschikbaar. Laat de beheerder dit controleren.", flags: MessageFlags.Ephemeral }); return true; }
      const slash = i.isChatInputCommand();
      let ctx: Context | undefined;
      if (!slash) {
        ctx = contexts.get(i.customId.slice(7));
        if (i.message.author.id !== app || !ctx || ctx.actor !== i.user.id || ctx.expires <= now()) {
          await i.reply({ content: "Deze keuze is verlopen of hoort niet bij jou. Open /besc bucks opnieuw.", flags: MessageFlags.Ephemeral }); return true;
        }
        await i.deferUpdate();
      } else { await i.deferReply({ flags: MessageFlags.Ephemeral }); }
      const reply = (data: Payload) => i.editReply({ ...data, allowedMentions: { parse: [] } });
      try {
        if (slash) {
          const sub = i.options.getSubcommand();
          if (sub === "saldo") {
            const a = await api.account(i.user.id);
            await reply({ content: `**Jouw BESC Bucks en XP**\nBeschikbaar: **${format(a.available)} Bucks**\nGereserveerd: ${format(a.reserved)} Bucks\nTotaal: ${format(a.bucks)} Bucks\nXP: **${format(a.xp)}** · Level **${a.level}**${worker.outstanding(i.user.id) ? "\nEen eerdere actie wordt nog verwerkt of vereist controle." : ""}`, components: [], embeds: [] });
          } else if (sub === "beloningen" || sub === "aanvragen") {
            const page = i.options.getInteger("pagina") ?? 1;
            if (!Number.isInteger(page) || page < 1 || page > 4000) throw new ApiError("invalid_fields", 400);
            await reply(await list(sub, i.user.id, (page - 1) * 25));
          } else { await reply({ content: "Onbekend Bucks-commando.", components: [], embeds: [] }); }
        } else if (ctx?.kind === "page") { await reply(await list(ctx.resource, i.user.id, ctx.offset)); }
        else if (ctx?.kind === "choose") {
          if (!i.isStringSelectMenu() || i.values.length !== 1) throw new ApiError("invalid_fields", 400);
          const item = ctx.items.find(x => x.id === i.values[0]); if (!item) throw new ApiError("invalid_fields", 400);
          if ("status" in item && item.status !== "pending") {
            await reply({ content: `**${status[item.status]}** — ${clean(item.title, 120)}\n${format(item.price)} Bucks${item.reason ? `\n${clean(item.reason, 1000)}` : ""}`,
              components: [{ type: 1, components: [button("Terug naar aanvragen", add({ actor: i.user.id, expires: now() + 30 * 60_000, kind: "page", resource: "aanvragen", offset: 0 }))] }], embeds: [] });
            contexts.delete(i.customId.slice(7)); return true;
          }
          const operation = ctx.resource === "beloningen" ? "request" : "cancel";
          const data = operation === "request" ? { reward_id: item.id, version: item.version } : { id: item.id, version: item.version };
          const token = add({ actor: i.user.id, expires: now() + 30 * 60_000, kind: "confirm", operation, data });
          await reply({ content: operation === "request" ? `Wil je deze beloning aanvragen? **${format(item.price)} Bucks worden gereserveerd** totdat je aanvraag is beoordeeld.` : `Wil je deze aanvraag annuleren? **${format(item.price)} Bucks komen vrij** als de aanvraag nog onbehandeld is.`,
            embeds: [{ title: clean(item.title, 120), description: "description" in item ? clean(item.description, 2000) || "Geen extra uitleg." : `Status: ${status[item.status]}`, color: 0xe31b23 }],
            components: [{ type: 1, components: [button(operation === "request" ? "Aanvragen en Bucks reserveren" : "Annuleren en Bucks vrijgeven", token, operation === "request" ? 1 : 4)] }] });
          contexts.delete(i.customId.slice(7));
        } else if (ctx?.kind === "confirm") {
          if (!i.isButton()) throw new ApiError("invalid_fields", 400);
          // A durable record exists before any API mutation. No interaction tokens are kept.
          const job: RewardJob = { id: i.id, actor: i.user.id, operation: ctx.operation, data: ctx.data };
          worker.enqueue(job); contexts.delete(i.customId.slice(7)); await worker.tick();
          const r = worker.read(job.operation, job.id);
          if (r?.phase === "done") await reply({ content: ctx.operation === "request" ? "Je beloning is aangevraagd. De Bucks zijn gereserveerd. Bekijk /besc bucks aanvragen voor de beslissing." : "Je aanvraag is geannuleerd en de gereserveerde Bucks zijn vrijgegeven.", components: [], embeds: [] });
          else if (r?.phase === "rejected") await reply({ content: rewardError(new ApiError(r.error ?? "upstream_unavailable", 422)), components: [], embeds: [] });
          else await reply({ content: "Je actie staat in de verwerkingswachtrij of de uitkomst is nog niet bevestigd. Dien dezelfde actie niet opnieuw in. Bekijk /besc bucks aanvragen voor de stand van zaken.", components: [], embeds: [] });
        }
      } catch (e) {
        const message = e instanceof Error && e.message === "rewards_previous_action_unresolved"
          ? "Een eerdere aanvraag of annulering is nog niet afgerond. Wacht op de uitkomst of laat een beheerder controleren; dien die niet opnieuw in." : rewardError(e);
        await reply({ content: message, components: [], embeds: [] });
      }
    } catch { log("rewards_reply_unavailable"); }
    return true;
  };
}
