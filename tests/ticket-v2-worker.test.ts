import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Collection, ChannelType, PermissionFlagsBits, PermissionsBitField, type Client } from "discord.js";
import type { V2Api } from "../src/ticket-v2-api.ts";
import type { ConfigDelivery } from "../src/ticket-v2-schema.ts";
import { createConfigWorker, ConfigFailure } from "../src/ticket-v2-worker.ts";
import { DiscordConfigEffects, panelOptions, panelCustomId } from "../src/ticket-v2-discord.ts";
import type { V2State, EffectRecord } from "../src/ticket-v2-state.ts";
const f = JSON.parse(readFileSync(new URL("./fixtures/ticketing-v2.fixtures.json", import.meta.url), "utf8"));
const guild = f.configResponse.guildId, app = f.publicationDelivery.payload.applicationId, channelId = f.publicationDelivery.channelId;
function delivery(extra: Partial<ConfigDelivery> = {}): ConfigDelivery { return { ...structuredClone(f.publicationDelivery), leasedUntil: new Date(Date.now() + 60000).toISOString(), ...extra }; }
function state(): V2State { const records = new Map<string, EffectRecord>(), parents = new Set<string>();return { parents:()=>[...parents],parent:async id=>{parents.add(id);},effect:id=>records.get(id),remember:async(id,e)=>{records.set(id,e);},forget:async id=>{records.delete(id);} }; }
function api(extra: Partial<V2Api> = {}): V2Api { return { config:async()=>f.configResponse,revision:async()=>f.typeRevisionResponse.typeRevision,intent:async()=>f.intentResponse,intake:async()=>f.intakeResponse,report:async()=>{},claim:async()=>[],inspect:async d=>d,complete:async()=>{},fail:async()=>{},...extra }; }
function discord() {
  const messages = new Collection<string, any>(); let sends=0,edits=0; const events: string[]=[];
  let loseSend=false,loseEdit=false; const permissions = new PermissionsBitField(Object.values(PermissionFlagsBits).filter(p=>p!==PermissionFlagsBits.Administrator));
  const channel:any = {id:channelId,guildId:guild,type:ChannelType.GuildText,permissionsFor:()=>permissions,
    messages:{fetch:async(query:any)=>{if(typeof query==='string'){const m=messages.get(query);if(!m)throw {code:10008};return m;}return messages;}},
    send:async(payload:any)=>{sends++;events.push('send');const m=message(`11111111111111111${sends}`,payload);if(loseSend){loseSend=false;throw Error('TEST lost Discord send response');}return m;}};
  function message(id:string,payload:any){const m:any={id,channelId,guildId:guild,author:{id:app},content:'',embeds:structuredClone(payload.embeds??[]),components:(payload.components??[]).map((row:any)=>({toJSON:()=>structuredClone(row)})),nonce:payload.nonce,
    edit:async(data:any)=>{edits++;events.push('edit');if(data.embeds)m.embeds=structuredClone(data.embeds);if(data.components)m.components=data.components.map((row:any)=>({toJSON:()=>structuredClone(row)}));if(loseEdit){loseEdit=false;throw Error('TEST lost Discord edit response');}return m;}};messages.set(id,m);return m;}
  const client:any = {user:{id:app},application:{id:app},channels:{fetch:async()=>channel},guilds:{fetch:async()=>({members:{fetch:async()=>({user:{bot:false},permissions:new PermissionsBitField(PermissionFlagsBits.ManageGuild)})},channels:{fetch:async()=>new Collection([[channelId,{...channel,name:'TEST channel'}]])}})}};
  return {client:client as Client,channel,messages,message,events,permissions,sends:()=>sends,edits:()=>edits,loseSend:()=>{loseSend=true;},loseEdit:()=>{loseEdit=true;}};
}
test("Nieuwe publicatie gebruikt klassieke embed, lege mentions, vaste nonce en inspect vlak voor send",async()=>{
 const mock=discord(),d=delivery(),journal=state(),effect=new DiscordConfigEffects(mock.client,guild,app,journal);
 const inspect=async()=>{mock.events.push('inspect');return d;};const result=await effect.execute(d,inspect);
 assert.equal(mock.sends(),1);assert.deepEqual(mock.events,['inspect','inspect','send']);assert.equal(result.message_id,'111111111111111111');
 assert.equal(journal.effect(d.id)?.message,result.message_id);const options=panelOptions(d);assert.deepEqual(options.allowedMentions,{parse:[]});assert.equal(options.nonce,d.nonce);assert.equal(options.enforceNonce,true);assert.equal(options.flags,undefined);
});
test("Verloren Discord-sendresponse wordt via marker en inhoud gereconcilieerd zonder tweede paneel",async()=>{
 const mock=discord(),d=delivery(),effect=new DiscordConfigEffects(mock.client,guild,app,state());mock.loseSend();
 await assert.rejects(effect.execute(d,async()=>d));const reconciled={...d,reconcile:true};
 const result=await effect.execute(reconciled,async()=>reconciled);assert.equal(mock.sends(),1);assert.equal(mock.edits(),0);assert.equal(result.message_id,'111111111111111111');
});
test("Onzekere eerste plaatsing zonder bewezen marker wordt niet blind herhaald",async()=>{
 const mock=discord(),d=delivery({reconcile:true}),effect=new DiscordConfigEffects(mock.client,guild,app,state());
 await assert.rejects(effect.execute(d,async()=>d),e=>e instanceof ConfigFailure&&e.code==='outcome_unknown');assert.equal(mock.sends(),0);
});
test("Intrekking tijdens laatste inspect maakt geen nieuw paneel",async()=>{
 const mock=discord(),d=delivery(),effect=new DiscordConfigEffects(mock.client,guild,app,state());let checks=0;
 const result=await effect.execute(d,async()=>({...d,withdrawn:++checks>=2}));assert.equal(mock.sends(),0);assert.equal(result.message_absent,true);
});
test("Ingetrokken mapped update bevestigt skipped met oorspronkelijke message-ID zonder edit",async()=>{
 const mock=discord(),d=delivery({messageId:'111111111111111111',withdrawn:true});const old={...d,revisionId:'20000000-0000-4000-8000-000000000099'};
 mock.message(d.messageId!,panelOptions(old));const effect=new DiscordConfigEffects(mock.client,guild,app,state());
 const result=await effect.execute(d,async()=>d);assert.equal(result.skipped,true);assert.equal(result.message_id,d.messageId);assert.equal(mock.edits(),0);
});
test("Bestaand resultaat na intrekking kan als uitgevoerd worden bevestigd zonder herhalen",async()=>{
 const mock=discord(),d=delivery({withdrawn:true,reconcile:true});mock.message('111111111111111111',panelOptions(d));
 const result=await new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d);assert.equal(result.message_id,'111111111111111111');assert.equal(mock.sends(),0);assert.equal(mock.edits(),0);
});
test("Mapped publicatie met verloren edit-ack wordt niet opnieuw aangepast",async()=>{
 const mock=discord(),d=delivery({messageId:'111111111111111111'});mock.message(d.messageId!,panelOptions({...d,revisionId:'20000000-0000-4000-8000-000000000099'}));mock.loseEdit();
 const effect=new DiscordConfigEffects(mock.client,guild,app,state());await assert.rejects(effect.execute(d,async()=>d));
 const r={...d,reconcile:true};await effect.execute(r,async()=>r);assert.equal(mock.edits(),1);assert.equal(mock.sends(),0);
});
test("Dubbele paneelmarkers blokkeren uitvoering",async()=>{
 const mock=discord(),d=delivery();mock.message('111111111111111111',panelOptions(d));mock.message('222222222222222222',panelOptions(d));
 await assert.rejects(new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d),e=>e instanceof ConfigFailure&&e.code==='duplicate_marker');assert.equal(mock.sends(),0);
});
test("Niet-eigen mapped bericht of verkeerde kanaalbinding wordt niet bewerkt",async()=>{
 const mock=discord(),d=delivery({messageId:'111111111111111111'}),m=mock.message(d.messageId!,panelOptions(d));m.author.id='222222222222222222';
 await assert.rejects(new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d));assert.equal(mock.edits(),0);
});
test("Ontbrekend mapped paneel wordt niet vervangen door blind nieuw bericht",async()=>{
 const mock=discord(),d=delivery({messageId:'111111111111111111'});
 await assert.rejects(new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d),e=>e instanceof ConfigFailure&&e.code==='message_missing');assert.equal(mock.sends(),0);
});
test("Paneeluitschakeling behoudt marker maar blokkeert alle interacties en is herhaalbaar",async()=>{
 const mock=discord(),d=delivery({kind:'disable_panel',messageId:'111111111111111111'});mock.message(d.messageId!,panelOptions({...d,kind:'publish_panel'}));
 const effects=new DiscordConfigEffects(mock.client,guild,app,state());await effects.execute(d,async()=>d);await effects.execute({...d,reconcile:true},async()=>d);
 assert.equal(mock.edits(),1);assert.equal(mock.messages.get(d.messageId!)?.components[0].toJSON().components[0].disabled,true);
 assert.equal(mock.messages.get(d.messageId!)?.components[0].toJSON().components[0].custom_id,panelCustomId(d.panelId!,d.revisionId!));
});
test("Verwijderd paneel kan zonder Discordeffect als disabled bevestigd worden",async()=>{
 const mock=discord(),d=delivery({kind:'disable_panel',messageId:'111111111111111111'});
 const result=await new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d);assert.equal(result.disabled,true);assert.equal(mock.sends(),0);
});
test("Kanaalrapport toont effectieve ontbrekende rechten, geen verzonnen positief bewijs",async()=>{
 const mock=discord(),d=delivery({kind:'check_channel'});mock.permissions.remove(PermissionFlagsBits.ManageThreads);
 const r=await new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d);assert.equal(r.permissions_ok,false);assert.deepEqual(r.missing_permissions,['manage_threads']);
});
test("Beheerbewijs controleert uitsluitend de opdrachtactor met actuele ManageGuild",async()=>{
 const mock=discord(),d=delivery({kind:'verify_server_admin',payload:{applicationId:app,discordUserId:'111111111111111111'}});
 const r=await new DiscordConfigEffects(mock.client,guild,app,state()).execute(d,async()=>d);assert.equal(r.is_admin,true);assert.equal(r.discord_user_id,'111111111111111111');
});
test("Runtime rapporteert alleen maximaal 50 GuildText-metadata zonder leden, rollen of inhoud",async()=>{
 const mock=discord();const report=await new DiscordConfigEffects(mock.client,guild,app,state()).report();assert.deepEqual(report,[{id:channelId,name:'TEST channel',type:0}]);
});
test("Configworker herhaalt geen effect wegens verloren complete-antwoord en houdt journal",async()=>{
 let writes=0,cleanups=0;const d=delivery(),logs:string[]=[];
 const worker=createConfigWorker(api({claim:async()=>[d],complete:async()=>{throw Error('TEST secret upstream response');}}),{execute:async()=>{writes++;return{};},confirmed:async()=>{cleanups++;}},c=>logs.push(c),'worker_123');
 await worker();assert.equal(writes,1);assert.equal(cleanups,0);assert.deepEqual(logs,['config_complete_ack_unavailable']);
});
test("Worker bevestigt pas na actuele inspect en ruimt journal alleen na geaccepteerde complete op",async()=>{
 const order:string[]=[],d=delivery();const worker=createConfigWorker(api({claim:async()=>[d],inspect:async()=>{order.push('inspect');return d;},complete:async()=>{order.push('complete');}}),{execute:async(_d,inspect)=>{await inspect();order.push('effect');return{};},confirmed:async()=>{order.push('cleanup');}},()=>{},'worker_123');
 await worker();assert.deepEqual(order,['inspect','inspect','effect','complete','cleanup']);
});
test("Leaseverlies tijdens inspect voorkomt effect en overlappende ticks blijven geserialiseerd",async()=>{
 const d=delivery();let claims=0,effects=0;const worker=createConfigWorker(api({claim:async()=>{claims++;await new Promise(r=>setTimeout(r,10));return[d];},inspect:async()=>{throw Error('TEST lease lost');}}),{execute:async()=>{effects++;return{};}},()=>{},'worker_123');
 await Promise.all([worker(),worker()]);assert.equal(claims,1);assert.equal(effects,0);
});
