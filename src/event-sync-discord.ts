import type { DiscordEventPayload, EventSyncDiscord, RemoteScheduledEvent } from './event-sync-worker.ts';
const snow = /^[1-9]\d{16,19}$/, uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export interface EventInterestDiscord { interestedUsers(id: string, publicationId: string): Promise<string[]> }
/** Dedicated bounded requests: no redirects, automatic mutation retries or late queued effects. */
export function createEventSyncDiscord(config: { token: string; guildId: string; applicationId: string; apiUrl: string },
  fetcher: typeof fetch = fetch, now = Date.now): EventSyncDiscord & EventInterestDiscord {
  const origin = new URL(config.apiUrl).origin, path = `guilds/${config.guildId}/scheduled-events`;
  let cooldown = 0;
  async function request(route: string, method = 'GET', body?: unknown): Promise<unknown> {
    if (now() < cooldown) throw Error('discord_cooldown');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(`https://discord.com/api/v10/${route}`, { method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bot ${config.token}`, 'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://github.com/missrinam80-besc/besc-discordbot, 2.0.0)' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const reader = response.body?.getReader(); if (!reader) throw Error('discord_response_unavailable');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 262144) throw Error('discord_response_too_large'); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (response.status === 429) {
        const seconds = object(value) ? Number(value.retry_after) : Number(response.headers.get('Retry-After'));
        cooldown = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) * 1000 : 60000);
      } else if (response.headers.get('X-RateLimit-Remaining') === '0') {
        const seconds = Number(response.headers.get('X-RateLimit-Reset-After'));
        cooldown = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) * 1000 : 1000);
      }
      if (response.status === 404 && method === 'GET') return null;
      if (!response.ok) throw Error('discord_request_unconfirmed');
      return value;
    } finally { clearTimeout(timer); }
  }
  function decode(v: unknown): RemoteScheduledEvent {
    if (!object(v) || typeof v.id !== 'string' || !snow.test(v.id) || v.guild_id !== config.guildId
      || typeof v.creator_id !== 'string' || !snow.test(v.creator_id) || ![1, 2, 3, 4].includes(Number(v.status))) throw Error('invalid_discord_event');
    let publication: string | null = null;
    if (typeof v.description === 'string') {
      const last = v.description.split('\n').at(-1) ?? '', prefix = `Meer informatie en aanmelden: ${origin}/events/aanmelden/`;
      if (last.startsWith(prefix) && uuid.test(last.slice(prefix.length))) publication = last.slice(prefix.length);
    }
    const payload = v.entity_type === 3 && v.privacy_level === 2 && v.channel_id === null && object(v.entity_metadata)
      && typeof v.entity_metadata.location === 'string' && typeof v.name === 'string' && typeof v.description === 'string'
      && typeof v.scheduled_start_time === 'string' && typeof v.scheduled_end_time === 'string'
      ? { name: v.name, description: v.description, scheduled_start_time: v.scheduled_start_time, scheduled_end_time: v.scheduled_end_time,
        privacy_level: 2 as const, entity_type: 3 as const, channel_id: null, entity_metadata: { location: v.entity_metadata.location } } : null;
    return { id: v.id, guild_id: config.guildId, creator_id: v.creator_id, status: Number(v.status) as 1 | 2 | 3 | 4, publication_id: publication, payload };
  }
  const inspect = async (id: string) => { if (!snow.test(id)) throw Error('invalid_event_id'); const v = await request(`${path}/${id}`); return v === null ? null : decode(v); };
  return {
    guildId: config.guildId, botUserId: config.applicationId, inspect,
    async findByReference(id) {
      if (!uuid.test(id)) throw Error('invalid_publication'); const v = await request(path);
      if (!Array.isArray(v) || v.length > 100) throw Error('invalid_event_list');
      return v.map(decode).filter(e => e.creator_id === config.applicationId && e.publication_id === id);
    },
    async create(payload) {
      const v = decode(await request(path, 'POST', payload));
      if (v.creator_id !== config.applicationId || !v.publication_id) throw Error('event_create_unconfirmed'); return v.id;
    },
    async update(id, payload) {
      if (!snow.test(id)) throw Error('invalid_event_id');
      const v = decode(await request(`${path}/${id}`, 'PATCH', payload));
      if (v.id !== id || v.creator_id !== config.applicationId || !v.publication_id) throw Error('event_update_unconfirmed');
    },
    async setStatus(id, status) {
      if (!snow.test(id)) throw Error('invalid_event_id');
      const v = decode(await request(`${path}/${id}`, 'PATCH', { status }));
      if (v.id !== id || v.creator_id !== config.applicationId || v.status !== status) throw Error('event_status_unconfirmed');
    },
    async interestedUsers(id, publicationId) {
      const event = await inspect(id);
      if (!event || event.creator_id !== config.applicationId || event.publication_id !== publicationId || ![1, 2].includes(event.status)) throw Error('event_not_current');
      const users = new Set<string>(); let after: string | undefined;
      for (let page = 0; page <= 50; page++) {
        const v = await request(`${path}/${id}/users?limit=100&with_member=false${after ? `&after=${after}` : ''}`);
        if (!Array.isArray(v) || v.length > 100) throw Error('invalid_interest_page');
        let greatest = after;
        for (const row of v) {
          if (!object(row) || !object(row.user) || typeof row.user.id !== 'string' || !snow.test(row.user.id)
            || row.guild_scheduled_event_id !== id || (after && BigInt(row.user.id) <= BigInt(after)) || users.has(row.user.id)) throw Error('invalid_interest_page');
          users.add(row.user.id); if (!greatest || BigInt(row.user.id) > BigInt(greatest)) greatest = row.user.id;
        }
        if (users.size > 5000) throw Error('interest_limit_exceeded');
        if (v.length < 100) return [...users];
        if (!greatest || greatest === after) throw Error('interest_cursor_stalled'); after = greatest;
      }
      throw Error('interest_limit_exceeded');
    },
  };
}
