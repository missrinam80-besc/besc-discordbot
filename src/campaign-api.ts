import { ApiError, createTransport } from './api.ts';
import { snowflake, uuid } from './ticket-api.ts';

export const campaignScope = 'campaigns:own:read';
export type OwnCampaign = { id: string; title: string; synthetic: boolean; path: string };
export type CampaignPage = { campaigns: OwnCampaign[]; nextOffset: number | null };
export interface CampaignApi { own(actor: string, offset: number): Promise<CampaignPage> }
const invalid = (): never => { throw new ApiError('invalid_response', 502); };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function createCampaignApi(config: { apiUrl: string; apiKey: string; guildId: string }, fetcher: typeof fetch = fetch): CampaignApi {
  const get = createTransport(config, fetcher);
  return { async own(actor, offset) {
    if (!snowflake.test(actor) || !Number.isInteger(offset) || offset < 0 || offset > 99975) invalid();
    const data = await get('campaigns', { discord_user_id: actor, offset: String(offset) });
    if (!exact(data, ['schemaVersion', 'campaigns', 'nextOffset']) || data.schemaVersion !== 1 || !Array.isArray(data.campaigns) || data.campaigns.length > 5) invalid();
    if (!(data.nextOffset === null || Number.isInteger(data.nextOffset) && data.nextOffset === offset + 5 && Number(data.nextOffset) <= 99975)) invalid();
    const seen = new Set<string>();
    const campaigns: OwnCampaign[] = (data.campaigns as unknown[]).map(value => {
      if (!object(value) || !exact(value, ['id', 'title', 'synthetic', 'path']) || typeof value.id !== 'string' || !uuid.test(value.id)
        || seen.has(value.id) || typeof value.title !== 'string' || value.title.length > 160 || !value.title.trim()
        || typeof value.synthetic !== 'boolean' || value.path !== `/app/campagnes/${value.id}/proef`) return invalid();
      seen.add(value.id);
      return { id: value.id, title: value.title, synthetic: value.synthetic, path: value.path as string };
    });
    return { campaigns, nextOffset: data.nextOffset as number | null };
  } };
}
