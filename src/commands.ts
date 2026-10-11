import { SlashCommandBuilder, InteractionContextType } from "discord.js";
export const bescCommand = new SlashCommandBuilder()
  .setName("besc").setDescription("BESC Command Center")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(c => c.setName("status").setDescription("Controleer de BESC API-verbinding"))
  .addSubcommand(c => c.setName("account").setDescription("Controleer jouw gekoppelde BESC-account"))
  .addSubcommand(c => c.setName("events").setDescription("Lees events waarvoor jij toegang hebt")
    .addIntegerOption(o => o.setName("pagina").setDescription("Pagina van vijf events").setMinValue(1).setMaxValue(20000)));
