import { MessageFlags, escapeMarkdown } from 'discord.js';
import type { CampaignApi,CampaignSubmitApi } from './campaign-api.ts';
import { errorMessage, InteractionDeduplicator } from './handler.ts';
import { validateUrl } from './config.ts';

export interface CampaignInteraction {
  id: string; commandName: string; guildId: string | null; user: { id: string };
  options: { getSubcommandGroup(required?: boolean): string | null; getSubcommand(): string; getInteger(name: string): number | null; getString?(name:string):string|null };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string; allowedMentions: { parse: never[] } }): Promise<unknown>;
}
export function isCampaignInteraction(interaction: Pick<CampaignInteraction, 'commandName' | 'options'>) {
  return interaction.commandName === 'besc' && interaction.options.getSubcommandGroup(false) === 'campagne';
}
function title(value: string) {
  // Display plain titles: no mentions, user-controlled links, markdown or controls.
  return escapeMarkdown(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/@/g, '＠').replace(/</g, '‹').replace(/>/g, '›').replace(/\./g, '․').replace(/:/g, '∶').slice(0, 100));
}
export function createCampaignHandler(api: CampaignApi & Partial<CampaignSubmitApi>, config: { guildId: string; webUrl: string;submissionsEnabled?:boolean }, dedupe = new InteractionDeduplicator(), log: (code: string) => void = () => {}) {
  const origin = validateUrl(config.webUrl, true).origin;
  return async (interaction: CampaignInteraction) => {
    if (!isCampaignInteraction(interaction) || !dedupe.claim(interaction.id)) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });
      if (interaction.guildId !== config.guildId) { await reply('Dit commando is alleen beschikbaar op de ingestelde BESC-server.'); return; }
      if(interaction.options.getSubcommand()==='indienen'){
        if(!config.submissionsEnabled||!api.submit){await reply('Bijdragen indienen is hier nog niet ingeschakeld.');return;}
        let campaign=interaction.options.getString?.('campagne')??'';const post=interaction.options.getString?.('link')??'';
        try{if(!/^[a-f0-9-]{36}$/i.test(campaign)){const link=new URL(campaign);if(link.origin!==origin||link.username||link.password||link.search||link.hash)throw Error();campaign=/^\/app\/campagnes\/([a-f0-9-]{36})(?:\/proef)?$/i.exec(link.pathname)?.[1]??'';}
          if(!/^[a-f0-9-]{36}$/i.test(campaign)||!post)throw Error();
        }catch{await reply('Gebruik de campagnelink uit Command Center en een ondersteunde Twitch- of YouTube-link.');return;}
        try{const result=await api.submit(interaction.user.id,campaign,post,interaction.id);await reply(result.replay?'Deze bijdrage was al ontvangen. Controleer de actuele beoordeling in Command Center.':'De bijdrage is ontvangen. De beoordeling verloopt in Command Center; er is geen beloning toegekend.');}
        catch{await reply('De ontvangst kon niet worden bevestigd. Controleer eerst de actuele campagne in Command Center voordat je opnieuw indient.');}
        return;
      }
      if (interaction.options.getSubcommand() !== 'mijn') { await reply('Onbekend campagnecommando.'); return; }
      const page = interaction.options.getInteger('pagina') ?? 1;
      if (!Number.isInteger(page) || page < 1 || page > 19996) { await reply('Kies een geldige pagina.'); return; }
      try {
        const result = await api.own(interaction.user.id, (page - 1) * 5);
        const links = result.campaigns.map(c => new URL(c.path, origin).href);
        const budget = Math.min(100, Math.max(1, Math.floor((1700 - links.reduce((total,link) => total + link.length + 40, 0)) / Math.max(result.campaigns.length, 1))));
        const lines = result.campaigns.map((c,i) => `• ${title(c.title).slice(0,budget)}${c.synthetic ? ' (test)' : ''}\n  [Open in Command Center](<${links[i]}>)`);
        // A malformed operator URL must not yield oversized Discord messages.
        if (lines.join('\n').length > 1800) { await reply('De campagnekoppeling vereist beheercontrole.'); return; }
        await reply(lines.length ? `Mijn actuele campagnes (pagina ${page}):\n${lines.join('\n')}\n${result.nextOffset === null ? '' : `Meer: /besc campagne mijn pagina:${page + 1}`}` : 'Geen eigen actuele campagnes op deze pagina.');
      } catch (error) { await reply(errorMessage(error)); }
    } catch { log('campaign_reply_unavailable'); }
  };
}
