import { SlashCommandBuilder, InteractionContextType } from "discord.js";
export function createBescCommand(tickets = false, rewards = false, campaigns = false) {
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
if (rewards) command.addSubcommandGroup(g => g.setName("bucks").setDescription("Jouw BESC Bucks en XP")
  .addSubcommand(c => c.setName("saldo").setDescription("Bekijk je Bucks, XP en level"))
  .addSubcommand(c => c.setName("beloningen").setDescription("Bekijk en vraag een BESC-beloning aan")
    .addIntegerOption(o => o.setName("pagina").setDescription("Pagina van de beloningen").setMinValue(1).setMaxValue(4000)))
  .addSubcommand(c => c.setName("aanvragen").setDescription("Bekijk je aanvragen en annuleer een open aanvraag")
    .addIntegerOption(o => o.setName("pagina").setDescription("Pagina van je aanvragen").setMinValue(1).setMaxValue(4000))));
if (campaigns) command.addSubcommandGroup(g => g.setName('campagne').setDescription('Jouw BESC-campagnes')
  .addSubcommand(c => c.setName('mijn').setDescription('Bekijk je eigen actuele campagnes')
    .addIntegerOption(o => o.setName('pagina').setDescription('Pagina van vijf campagnes').setMinValue(1).setMaxValue(19996))));
return command;
}
export const bescCommand = createBescCommand();
