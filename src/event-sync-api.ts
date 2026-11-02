import { createTransport, ApiError } from './api.ts';
import type { DiscordEventPayload, EventSyncApi, EventSyncJob, EventSyncLease } from './event-sync-worker.ts';
import { validEventSyncLease } from './event-sync-worker.ts';
const snow = /^[1-9]\d{16,19}$/, uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function object(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
export function decodeEventJob(value: unknown, guild: string, origin: string): EventSyncJob | null {
  if (value === null) return null;
  if (!object(value) || !Boolean(validEventSyncLease(value)) || value.guild_id !== guild
    || typeof value.publication_id !== 'string' || !uuid.test(value.publication_id)
    || typeof value.event_id !== 'string' || !uuid.test(value.event_id)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !['upsert', 'withdraw', 'complete'].includes(String(value.operation))
    || !(value.discord_event_id === null || typeof value.discord_event_id === 'string' && snow.test(value.discord_event_id))) throw new ApiError('invalid_response', 502);
  let payload: DiscordEventPayload | null = null;
  if (value.operation === 'upsert') {
    const p = value.payload;
    if (!object(p) || Object.keys(p).sort().join(',') !== 'channel_id,description,entity_metadata,entity_type,name,privacy_level,scheduled_end_time,scheduled_start_time'
      || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100
      || typeof p.description !== 'string' || p.description.length > 1000
      || !p.description.endsWith(`\n\nMeer informatie en aanmelden: ${origin}/events/aanmelden/${value.publication_id}`)
      || p.privacy_level !== 2 || p.entity_type !== 3 || p.channel_id !== null
      || !object(p.entity_metadata) || Object.keys(p.entity_metadata).join(',') !== 'location'
      || typeof p.entity_metadata.location !== 'string' || !p.entity_metadata.location.trim() || p.entity_metadata.location.length > 100
      || ![p.scheduled_start_time, p.scheduled_end_time].every(x => typeof x === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x)))
      || Date.parse(String(p.scheduled_end_time)) <= Date.parse(String(p.scheduled_start_time))) throw new ApiError('invalid_response', 502);
    payload = p as unknown as DiscordEventPayload;
  } else if (value.payload !== null) throw new ApiError('invalid_response', 502);
  return { id: String(value.id), lease_token: String(value.lease_token), lease_until: String(value.lease_until), publication_id: value.publication_id,
    event_id: value.event_id, guild_id: guild, revision: Number(value.revision), operation: value.operation as EventSyncJob['operation'],
    discord_event_id: value.discord_event_id as string | null, payload };
}
export type InterestTarget = { publication_id: string; discord_event_id: string };
export interface EventInterestApi {
  interestTargets(): Promise<InterestTarget[]>;
  interestSnapshot(target: InterestTarget, users: string[], observedAt: string): Promise<void>;
}
export function createEventSyncApi(config: { apiUrl: string; apiKey: string; guildId: string }): EventSyncApi & EventInterestApi {
  const request = createTransport(config), origin = new URL(config.apiUrl).origin;
  const send = (op: string, body: Record<string, unknown>) => request(`event-sync/${op}`, {}, body);
  const lease = (worker: string, l: EventSyncLease) => ({ worker_id: worker, id: l.id, lease_token: l.lease_token });
  const ok = (b: Record<string, unknown>) => { if (b.ok !== true) throw new ApiError('invalid_response', 502); };
  return {
    async claim(worker) { const b = await send('claim', { worker_id: worker }); return decodeEventJob(b.job, config.guildId, origin); },
    async inspect(worker, l) { const b = await send('inspect', lease(worker, l)); return decodeEventJob(b.job, config.guildId, origin); },
    async dispatch(worker, l) { const b = await send('dispatch', lease(worker, l)); if (typeof b.authorized !== 'boolean') throw new ApiError('invalid_response', 502); return b.authorized; },
    async complete(worker, l, id) { ok(await send('complete', { ...lease(worker, l), discord_event_id: id })); },
    async fail(worker, l, code) { ok(await send('fail', { ...lease(worker, l), error_code: code })); },
    async interestTargets() {
      const b = await send('interest_targets', {});
      if (!Array.isArray(b.targets) || b.targets.length > 100 || !b.targets.every(t => object(t) && typeof t.publication_id === 'string' && uuid.test(t.publication_id) && typeof t.discord_event_id === 'string' && snow.test(t.discord_event_id))) throw new ApiError('invalid_response', 502);
      return b.targets.map(t => ({ publication_id: t.publication_id as string, discord_event_id: t.discord_event_id as string }));
    },
    async interestSnapshot(target, users, observedAt) { ok(await send('interest_snapshot', { ...target, user_ids: users, observed_at: observedAt })); },
  };
}
