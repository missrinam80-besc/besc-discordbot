import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction, type ModalSubmitInteraction } from "discord.js";
import { ApiError } from "./api.ts";
import { errorMessage } from "./handler.ts";
import type { TicketApi } from "./ticket-api.ts";
import { uuid } from "./ticket-api.ts";
import type { DiscordTickets } from "./ticket-discord.ts";
const formId = "besc:ticket:open:v1";
const errors = (e: unknown) => e instanceof ApiError && ["ticket_unavailable", "ticket_expired"].includes(e.code)
  ? "Dit ticket is niet beschikbaar voor jouw account." : errorMessage(e);
export function createTicketHandler(api: TicketApi, discord: DiscordTickets, log: (code: string) => void) {
  return async (interaction: ChatInputCommandInteraction | ModalSubmitInteraction): Promise<boolean> => {
    const command = interaction.isChatInputCommand() && interaction.commandName === "besc" && interaction.options.getSubcommandGroup(false) === "ticket";
    const submitted = interaction.isModalSubmit() && interaction.customId === formId;
    if (!command && !submitted) return false;
    try {
      if (interaction.guildId !== discord.guildId) {
        await interaction.reply({ content: "Dit ticketcommando werkt alleen op de ingestelde testserver.", flags: MessageFlags.Ephemeral }); return true;
      }
      if (interaction.isChatInputCommand() && interaction.options.getSubcommand() === "openen") {
        // Show the modal immediately; slow permission/network checks occur on submission.
        const modal = new ModalBuilder().setCustomId(formId).setTitle("BESC ticket openen").addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("subject").setLabel("Onderwerp").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(160).setRequired(true)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("content").setLabel("Omschrijving (geen bijlagen)").setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(4000).setRequired(true)));
        await interaction.showModal(modal); return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });
      try {
        await discord.validateRequester(interaction.user.id);
        if (interaction.isModalSubmit()) {
          const subject = interaction.fields.getTextInputValue("subject").trim();
          const content = interaction.fields.getTextInputValue("content").trim();
          const ticket = await api.create(interaction.user.id, subject, content, interaction.id);
          await reply(`Ticket geregistreerd: \`${ticket.ticketId}\`. De privéthread wordt aangemaakt.\nGebruik \`/besc ticket bekijken nummer:${ticket.ticketId}\` voor de threadlink.\nBijlagen en latere wijzigingen van Discordberichten worden niet overgenomen.`);
        } else {
          const id = interaction.options.getString("nummer", true);
          if (!uuid.test(id)) { await reply("Gebruik het volledige ticket-ID uit jouw bevestiging."); return true; }
          const ticket = await api.own(id, interaction.user.id);
          await reply(`Ticket \`${ticket.ticketId}\`: ${ticket.status}.${ticket.threadId ? `\n[Open jouw privéthread](https://discord.com/channels/${discord.guildId}/${ticket.threadId})` : "\nDe Discordkoppeling wacht nog op verwerking."}`);
        }
      } catch (e) { await reply(errors(e)); }
    } catch { log("ticket_interaction_unavailable"); }
    return true;
  };
}
