import { ApiError } from "./api.ts";
import { snowflake, uuid } from "./ticket-api.ts";
export const configScopes = ["bot-config:read", "bot-config:report", "bot-config:deliver"] as const;
export const features = ["typed_intake", "ticket_panels", "label_modals"] as const;
export type TicketEmbed = { title: string; description: string; color: string; footer: string };
export type Question = { id: string; label: string; description: string; placeholder: string; required: boolean } &
  ({ kind: "short" | "paragraph"; minLength: number; maxLength: number } | { kind: "single" | "multi"; maxValues: number; options: { value: string; label: string }[] });
export type TypeRevision = { typeId: string; revisionId: string; name: string; description: string; active: boolean; eligibility: "everyone" | "linked";
  parentChannelId: string; formTitle: string; subjectQuestionId: string | null; sortOrder: number; embed: TicketEmbed; questions: Question[] };
export type Panel = { panelId: string; revisionId: string; channelId: string; messageId: string; embed: TicketEmbed; typeRevisionIds: string[] };
export type TicketConfig = { schemaVersion: 2; guildId: string; configurationRevisionId: string; generatedAt: string; features: string[]; panels: Panel[]; typeRevisions: TypeRevision[] };
export type ConfigDelivery = { id: string; kind: "publish_panel" | "disable_panel" | "check_channel" | "verify_server_admin"; guildId: string;
  channelId: string | null; panelId: string | null; revisionId: string | null; messageId: string | null; payload: Record<string, unknown>;
  payloadHash: string; leaseToken: string; leasedUntil: string; nonce: string; marker: string; reconcile: boolean; withdrawn: boolean; allowedMentions: { parse: never[] } };
export const bad = (): never => { throw new ApiError("invalid_response", 502); };
export function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
const stable = /^[a-zA-Z0-9_-]{1,40}$/;
const str = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.trim().length >= min && v.length <= max;
const num = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const ids = (v: unknown, min: number, max: number): v is string[] => Array.isArray(v) && v.length >= min && v.length <= max && v.every(i => typeof i === "string" && uuid.test(i)) && new Set(v).size === v.length;
export function embed(v: unknown): TicketEmbed {
  if (!object(v) || !only(v, ["title", "description", "color", "footer"]) || !str(v.title, 1, 256) || !str(v.description, 1, 4096)
    || !str(v.footer, 0, 2048) || typeof v.color !== "string" || !/^#[a-f0-9]{6}$/i.test(v.color)
    || v.title.length + v.description.length + v.footer.length > 6000) return bad();
  return v as TicketEmbed;
}
export function typeRevision(v: unknown): TypeRevision {
  if (!object(v) || !only(v, ["typeId", "revisionId", "name", "description", "active", "eligibility", "parentChannelId", "formTitle", "subjectQuestionId", "sortOrder", "embed", "questions"])
    || typeof v.typeId !== "string" || !uuid.test(v.typeId) || typeof v.revisionId !== "string" || !uuid.test(v.revisionId)
    || !str(v.name, 1, 80) || !str(v.description, 0, 100) || typeof v.active !== "boolean" || !["everyone", "linked"].includes(String(v.eligibility))
    || typeof v.parentChannelId !== "string" || !snowflake.test(v.parentChannelId) || !str(v.formTitle, 1, 45) || !num(v.sortOrder, 0, 9999)
    || !(v.subjectQuestionId === null || typeof v.subjectQuestionId === "string" && stable.test(v.subjectQuestionId))
    || !Array.isArray(v.questions) || !v.questions.length || v.questions.length > 5) return bad();
  embed(v.embed); const seen = new Set<string>();
  for (const q of v.questions) {
    if (!object(q) || typeof q.id !== "string" || !stable.test(q.id) || seen.has(q.id) || !str(q.label, 1, 45) || !str(q.description, 0, 100)
      || !str(q.placeholder, 0, 100) || typeof q.required !== "boolean") return bad();
    seen.add(q.id);
    if (q.kind === "short" || q.kind === "paragraph") {
      if (!only(q, ["id", "label", "description", "placeholder", "required", "kind", "minLength", "maxLength"])
        || !num(q.minLength, 0, 4000) || !num(q.maxLength, 1, 4000) || Number(q.minLength) > Number(q.maxLength)) return bad();
    } else {
      if (!only(q, ["id", "label", "description", "placeholder", "required", "kind", "maxValues", "options"])
        || !["single", "multi"].includes(String(q.kind)) || !Array.isArray(q.options) || !q.options.length || q.options.length > 25
        || !num(q.maxValues, 1, q.options.length) || q.kind === "single" && q.maxValues !== 1) return bad();
      const values = new Set<string>();
      for (const o of q.options) {
        if (!object(o) || !only(o, ["value", "label"]) || typeof o.value !== "string" || !stable.test(o.value) || values.has(o.value) || !str(o.label, 1, 100)) return bad();
        values.add(o.value);
      }
    }
  }
  if (v.subjectQuestionId && !v.questions.some(q => object(q) && q.id === v.subjectQuestionId && ["short", "paragraph"].includes(String(q.kind)))) return bad();
  return v as TypeRevision;
}
export function ticketConfig(v: unknown, guild: string): TicketConfig {
  if (!object(v) || v.schemaVersion !== 2 || v.guildId !== guild || typeof v.configurationRevisionId !== "string" || !uuid.test(v.configurationRevisionId)
    || typeof v.generatedAt !== "string" || !Number.isFinite(Date.parse(v.generatedAt)) || !Array.isArray(v.features)
    || v.features.some(f => !features.includes(f)) || new Set(v.features).size !== v.features.length || !Array.isArray(v.panels) || v.panels.length > 500
    || !Array.isArray(v.typeRevisions) || v.typeRevisions.length > 12500) return bad();
  const types = new Set<string>();
  for (const t of v.typeRevisions) { const r = typeRevision(t); if (!r.active || types.has(r.revisionId)) return bad(); types.add(r.revisionId); }
  const panels = new Set<string>(); const messages = new Set<string>();
  for (const p of v.panels) {
    if (!object(p) || typeof p.panelId !== "string" || !uuid.test(p.panelId) || panels.has(p.panelId) || typeof p.revisionId !== "string" || !uuid.test(p.revisionId)
      || typeof p.channelId !== "string" || !snowflake.test(p.channelId) || typeof p.messageId !== "string" || !snowflake.test(p.messageId) || messages.has(p.messageId)
      || !ids(p.typeRevisionIds, 1, 25) || p.typeRevisionIds.some(id => !types.has(id))) return bad();
    embed(p.embed); panels.add(p.panelId); messages.add(p.messageId);
  }
  return v as TicketConfig;
}
export function configDelivery(v: unknown, guild: string, app: string): ConfigDelivery {
  if (!object(v) || typeof v.id !== "string" || !uuid.test(v.id) || !["publish_panel", "disable_panel", "check_channel", "verify_server_admin"].includes(String(v.kind))
    || v.guildId !== guild || !object(v.payload) || typeof v.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(v.payloadHash)
    || typeof v.leaseToken !== "string" || !uuid.test(v.leaseToken) || typeof v.leasedUntil !== "string" || !Number.isFinite(Date.parse(v.leasedUntil))
    || typeof v.nonce !== "string" || !/^\d{1,20}$/.test(v.nonce) || typeof v.reconcile !== "boolean" || typeof v.withdrawn !== "boolean"
    || !object(v.allowedMentions) || !Array.isArray(v.allowedMentions.parse) || v.allowedMentions.parse.length !== 0) return bad();
  for (const [k, regex] of [["channelId", snowflake], ["messageId", snowflake], ["panelId", uuid], ["revisionId", uuid]] as const)
    if (!(v[k] === null || typeof v[k] === "string" && regex.test(v[k] as string))) return bad();
  if (v.marker !== `besc-panel-${v.panelId ?? v.id}` || v.payload.applicationId !== app) return bad();
  if (v.kind === "publish_panel") {
    const p = v.payload;
    if (!v.channelId || !v.panelId || !v.revisionId || p.schemaVersion !== 2 || p.channelId !== v.channelId || p.expectedBotAuthorId !== app
      || !object(p.allowedMentions) || !Array.isArray(p.allowedMentions.parse) || p.allowedMentions.parse.length || !ids(p.typeRevisionIds, 1, 25)
      || !Array.isArray(p.typeRevisions) || p.typeRevisions.length !== p.typeRevisionIds.length) return bad();
    embed(p.embed); const seen = new Set<string>();
    for (const t of p.typeRevisions) { const r = typeRevision(t); if (!r.active || !p.typeRevisionIds.includes(r.revisionId) || seen.has(r.revisionId)) return bad(); seen.add(r.revisionId); }
  } else if (v.kind === "disable_panel") {
    if (!v.channelId || !v.panelId || !v.messageId || v.payload.expectedBotAuthorId !== app) return bad();
  } else if (v.kind === "check_channel") {
    if (!v.channelId || v.payload.channelId !== v.channelId) return bad();
  } else if (typeof v.payload.discordUserId !== "string" || !snowflake.test(v.payload.discordUserId)) return bad();
  return v as ConfigDelivery;
}
export function answersFor(t: TypeRevision, input: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);
  if (Object.keys(input).some(id => !t.questions.some(q => q.id === id))) throw new ApiError("invalid_answers", 400);
  for (const q of t.questions) {
    const v = input[q.id];
    if (q.kind === "short" || q.kind === "paragraph") {
      if (v === undefined && !q.required) { out[q.id] = ""; continue; }
      if (typeof v !== "string" || v.length > q.maxLength || v.trim().length > 0 && v.trim().length < q.minLength || q.required && !v.trim()) throw new ApiError("invalid_answers", 400);
      out[q.id] = v.trim();
    } else {
      const c = q as Extract<Question, { options: unknown }>;
      if (v === undefined && !c.required) { out[q.id] = []; continue; }
      if (!Array.isArray(v) || v.length > c.maxValues || c.required && !v.length || new Set(v).size !== v.length || v.some(a => !c.options.some(o => o.value === a))) throw new ApiError("invalid_answers", 400);
      out[q.id] = v;
    }
  }
  return out;
}
