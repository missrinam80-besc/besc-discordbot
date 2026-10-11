import { MessageFlags, escapeMarkdown } from "discord.js";
import { ApiError, type BotApi } from "./api.ts";
export interface CommandInteraction {
  id: string; commandName: string; guildId: string | null; user: { id: string };
  options: { getSubcommand(): string; getInteger(name: string): number | null };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string; allowedMentions: { parse: never[] } }): Promise<unknown>;
}
// Stops repeat delivery within one process. This is not durable write idempotency.
export class InteractionDeduplicator {
  private seen = new Map<string, number>();
  claim(id: string, now = Date.now()) {
    for (const [key, until] of this.seen) if (until <= now) this.seen.delete(key);
    if (this.seen.has(id) || this.seen.size >= 10_000) return false;
    this.seen.set(id, now + 15 * 60_000); return true;
  }
}
const safeText = (value: string, limit: number) => escapeMarkdown(value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, limit));
export function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "De aanvraag kon niet worden verwerkt. Probeer het later opnieuw.";
  switch (error.code) {
    case "account_unavailable": return "Geen geldige Discord-koppeling gevonden. Open je account in Command Center en koppel Discord.";
    case "membership_required": return "Je hebt geen actief lidmaatschap voor deze BESC-organisatie.";
    case "events_forbidden": return "Je account heeft geen toegang tot Events in Command Center.";
    case "invalid_client": case "insufficient_scope": case "guild_not_allowed": return "De bot heeft hier geen geldige API-toegang. Laat de beheerder de configuratie controleren.";
    case "rate_limited": return "Er zijn te veel aanvragen. Probeer over een minuut opnieuw.";
    default: return "Command Center is tijdelijk niet bereikbaar. Probeer het later opnieuw.";
  }
}
export function createCommandHandler(api: BotApi, guildId: string, deduplicator = new InteractionDeduplicator(),
  log: (record: { type: string; code: string }) => void = () => {}, webUrl?: string) {
  return async (interaction: CommandInteraction) => {
    if (interaction.commandName !== "besc" || !deduplicator.claim(interaction.id)) return;
    try {
      // Acknowledge before network I/O. All responses stay private to the requesting user.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = (content: string) => interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
      if (interaction.guildId !== guildId) { await reply("Dit commando is alleen beschikbaar op de ingestelde BESC-server."); return; }
      try {
        switch (interaction.options.getSubcommand()) {
          case "status": {
            const identity = await api.identity();
            await reply(`BESC API bereikbaar. Client: ${safeText(identity.clientId, 64)}. Deze proef leest alleen gegevens.`); break;
          }
          case "account": {
            const account = await api.account(interaction.user.id);
            await reply(`Je Discord-account is gekoppeld en je BESC-lidmaatschap is actief. Eventtoegang: ${account.canReadEvents ? "ja" : "nee"}.`); break;
          }
          case "events": {
            const page = interaction.options.getInteger("pagina") ?? 1;
            if (!Number.isInteger(page) || page < 1 || page > 20000) { await reply("Kies een geldige pagina."); break; }
            const result = await api.events(interaction.user.id, (page - 1) * 5);
            const lines = result.events.map(e => {
              const date = e.start_at ? new Date(e.start_at) : null;
              const when = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("nl-BE", {
                timeZone: "Europe/Brussels", dateStyle: "medium", timeStyle: "short" }).format(date) : e.start_date ?? "Datum nog onbekend";
              return `• ${safeText(e.title, 100)} — ${safeText(when, 45)} — ${safeText(e.status, 30)}\n  ${e.is_online ? "Online" : safeText(e.location ?? "Locatie nog onbekend", 60)}`;
            });
            await reply(lines.length ? `Events uit Command Center (pagina ${page}):\n${lines.join("\n")}\n${result.nextOffset === null ? "" : `Meer: /besc events pagina:${page + 1}`}`
              : "Geen events op deze pagina."); break;
          }
          default: await reply("Onbekend BESC-commando.");
        }
      } catch (error) {
        const accountLink = error instanceof ApiError && error.code === "account_unavailable" && webUrl
          ? `\n[Open je account](<${new URL("/app/account", webUrl).href}>)` : "";
        await reply(errorMessage(error) + accountLink);
      }
    } catch { log({ type: "interaction_failure", code: "discord_reply_unavailable" }); }
  };
}
