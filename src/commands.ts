import { SlashCommandBuilder, InteractionContextType } from "discord.js";
export function createBescCommand(tickets = false) {
const command = new SlashCommandBuilder()
  .setName("besc").setDescription("BESC Command Center")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(c => c.setName("status").setDescription("Controleer de BESC API-verbinding"))
  .addSubcommand(c => c.setName("account").setDescription("Controleer jouw gekoppelde BESC-account"))
  .addSubcommand(c => c.setName("events").setDescription("Lees events waarvoor jij toegang hebt")
    .addIntegerOption(o => o.setName("pagina").setDescription("Pagina van vijf events").setMinValue(1).setMaxValue(20000)));
if (tickets) command.addSubcommandGroup(g => g.setName("ticket").setDescription("BESC support")
  .addSubcommand(c => c.setName("openen").setDescription("Open een privéticket bij BESC"))
  .addSubcommand(c => c.setName("bekijken").setDescription("Bekijk jouw ticket")
    .addStringOption(o => o.setName("nummer").setDescription("Het ticket-ID uit jouw bevestiging").setRequired(true))));
return command;
}
export const bescCommand = createBescCommand();
