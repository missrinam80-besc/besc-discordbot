import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MessageFlags } from "discord.js";
import { ApiError } from "../src/api.ts";
import { createV2Handler, type V2Interaction } from "../src/ticket-v2-handler.ts";
import { panelCustomId } from "../src/ticket-v2-discord.ts";
import type { V2Api } from "../src/ticket-v2-api.ts";
const f=JSON.parse(readFileSync(new URL('./fixtures/ticketing-v2.fixtures.json',import.meta.url),'utf8'));
const guild=f.configResponse.guildId,app=f.publicationDelivery.payload.applicationId,user='111111111111111111',revision=f.typeRevisionResponse.typeRevision.revisionId,intent=f.intentResponse.intentId;
function api(extra:Partial<V2Api>={}):V2Api{return{config:async()=>structuredClone(f.configResponse),revision:async()=>structuredClone(f.typeRevisionResponse.typeRevision),intent:async()=>({...f.intentResponse,expiresAt:new Date(Date.now()+1800000).toISOString()}),intake:async()=>f.intakeResponse,report:async()=>{},claim:async()=>[],inspect:async d=>d,complete:async()=>{},fail:async()=>{},...extra};}
function interaction(kind:'slash'|'select'|'button'|'modal',extra:Record<string,unknown>={}){
 const events:string[]=[],replies:any[]=[],modals:any[]=[];
 const i:any={id:user,guildId:guild,channelId:f.panelDraft.channelId,user:{id:user},commandName:'besc',customId:'besc:v2:choose',values:[revision],deferred:false,replied:false,
  message:{id:f.configResponse.panels[0].messageId,author:{id:app},flags:{bitfield:MessageFlags.Ephemeral}},
  options:{getSubcommandGroup:()=> 'ticket',getSubcommand:()=> 'openen'},
  isChatInputCommand:()=>kind==='slash',isStringSelectMenu:()=>kind==='select',isButton:()=>kind==='button',isModalSubmit:()=>kind==='modal',
  fields:{fields:new Map(['onderwerp','omschrijving','omgeving'].map(id=>[id,{}])),getTextInputValue:(id:string)=>id==='onderwerp'?'TESTFIXTURE':'Private vraag',getStringSelectValues:()=>['discord']},
  reply:async(data:any)=>{events.push('reply');i.replied=true;replies.push(data);},deferReply:async(data:any)=>{events.push('defer');i.deferred=true;replies.push(data);},
  deferUpdate:async()=>{events.push('deferUpdate');i.deferred=true;},editReply:async(data:any)=>{events.push('edit');replies.push(data);},
  showModal:async(m:any)=>{events.push('modal');modals.push(m.toJSON());},...extra};
 return{i:i as V2Interaction,raw:i,events,replies,modals};
}
test('Slashintake acknowledge gebeurt vóór configuratieverkeer en toont gepubliceerde types privé',async()=>{
 const x=interaction('slash'),client=api({config:async()=>{x.events.push('api');return f.configResponse;}});
 await createV2Handler(client,guild,app,async()=>{},()=>{})(x.i);assert.deepEqual(x.events,['defer','api','edit']);assert.equal(x.replies[0].flags,MessageFlags.Ephemeral);assert.equal(x.replies[1].components[0].components[0].options[0].value,revision);
});
test('Conceptloze/uitgeschakelde configuratie veroorzaakt geen intent of Discordpublicatie',async()=>{
 let writes=0;const x=interaction('slash');await createV2Handler(api({config:async()=>({...f.configResponse,features:[],panels:[],typeRevisions:[]}),intent:async()=>{writes++;return f.intentResponse;}}),guild,app,async()=>{},()=>{})(x.i);
 assert.equal(writes,0);assert.match(x.replies.at(-1).content,/geen gepubliceerde/);assert.deepEqual(x.replies.at(-1).components,[]);
});
test('Panelinteraction draagt de echte actor en exacte bronbinding; uitleg bevat geen antwoorden',async()=>{
 let body:any;const p=f.configResponse.panels[0],x=interaction('select',{customId:panelCustomId(p.panelId,p.revisionId)});
 const client=api({intent:async(actor,r,source,key)=>{body={actor,r,source,key};return{...f.intentResponse,expiresAt:new Date(Date.now()+1800000).toISOString()};}});
 await createV2Handler(client,guild,app,async(a,parent)=>{assert.equal(a,user);assert.equal(parent,p.channelId);},()=>{})(x.i);
 assert.equal(body.actor,user);assert.equal(body.key,x.raw.id);assert.deepEqual(body.source,{source:'panel',panel_id:p.panelId,panel_revision_id:p.revisionId,channel_id:p.channelId,message_id:p.messageId});
 assert.equal(x.replies.at(-1).embeds[0].title,f.typeDraft.embed.title);assert.ok(x.replies.at(-1).components[0].components[0].custom_id.length<=100);
});
for(const [name,change]of [
 ['verkeerde guild',{guildId:'222222222222222222'}],['niet-eigen paneel',{message:{id:f.configResponse.panels[0].messageId,author:{id:'222222222222222222'},flags:{bitfield:0}}}],
 ['verkeerd bronkanaal',{channelId:'222222222222222222'}],['onbekende editie',{values:['20000000-0000-4000-8000-000000000099']}]
] as const)test(`Intake weigert ${name} zonder intent`,async()=>{
 let writes=0;const p=f.configResponse.panels[0],x=interaction('select',{customId:panelCustomId(p.panelId,p.revisionId),...change});
 await createV2Handler(api({intent:async()=>{writes++;return f.intentResponse;}}),guild,app,async()=>{},()=>{})(x.i);assert.equal(writes,0);
});
test('Modal opent zonder defer/netwerk op dezelfde interaction na gecachete intent',async()=>{
 let calls=0;const handler=createV2Handler(api({revision:async()=>{calls++;return f.typeRevisionResponse.typeRevision;}}),guild,app,async()=>{},()=>{});
 await handler(interaction('select').i);const button=interaction('button',{customId:`besc:v2:f:${intent}:${revision}`});const before=calls;
 await handler(button.i);assert.deepEqual(button.events,['modal']);assert.equal(calls,before);assert.equal(button.modals[0].custom_id,`besc:v2:m:${intent}:${revision}`);
});
test('Cacheverlies na restart laadt de oude editie en vraagt een nieuwe knopinteraction vóór modal',async()=>{
 const handler=createV2Handler(api(),guild,app,async()=>{},()=>{});const first=interaction('button',{customId:`besc:v2:f:${intent}:${revision}`});
 await handler(first.i);assert.deepEqual(first.events,['deferUpdate','edit']);assert.equal(first.modals.length,0);
 const second=interaction('button',{customId:first.replies.at(-1).components[0].components[0].custom_id});await handler(second.i);assert.deepEqual(second.events,['modal']);
});
test('Oude formulierintent blijft op zijn oorspronkelijke vragen na een nieuwe configuratie',async()=>{
 let captured:any;const old=structuredClone(f.typeRevisionResponse.typeRevision),newer=structuredClone(old);newer.revisionId='20000000-0000-4000-8000-000000000099';newer.questions[0].id='new_question';
 const handler=createV2Handler(api({config:async()=>({...f.configResponse,typeRevisions:[newer]}),revision:async id=>{assert.equal(id,revision);return old;},intake:async(actor,r,intentId,answers,key)=>{captured={actor,r,intentId,answers,key};return f.intakeResponse;}}),guild,app,async()=>{},()=>{});
 const modal=interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`});await handler(modal.i);
 assert.equal(captured.r,revision);assert.equal(captured.intentId,intent);assert.deepEqual({...captured.answers},{onderwerp:'TESTFIXTURE',omschrijving:'Private vraag',omgeving:['discord']});assert.equal(captured.actor,user);assert.equal(captured.key,modal.raw.id);assert.equal(modal.events[0],'defer');
});
test('Verloren intake-ack kan met dezelfde cached editie en submitkey terugkomen na nieuwe publicatie',async()=>{
 let created=false,revisionAvailable=true;const keys:string[]=[];
 const handler=createV2Handler(api({revision:async()=>{if(!revisionAvailable)throw new ApiError('revision_unavailable',410);return f.typeRevisionResponse.typeRevision;},intake:async(_a,_r,_i,_answers,key)=>{
  keys.push(key);if(!created){created=true;revisionAvailable=false;throw new ApiError('api_unavailable',503);}return f.intakeResponse;
 }}),guild,app,async()=>{},()=>{});
 await handler(interaction('select').i);
 await handler(interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`}).i);
 const replay=interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`});await handler(replay.i);
 assert.deepEqual(keys,[user,user]);assert.match(replay.replies.at(-1).content,/Ticket geregistreerd/);
});
test('Intrekking tijdens inzending toont een veilige privéfout zonder legacyfallback',async()=>{
 const x=interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`});let writes=0;
 await createV2Handler(api({intake:async()=>{writes++;throw new ApiError('intake_unavailable',409);}}),guild,app,async()=>{},()=>{})(x.i);
 assert.equal(writes,1);assert.match(x.replies.at(-1).content,/niet meer beschikbaar/);assert.deepEqual(x.replies.at(-1).components,[]);
});
test('Ongekoppelde gebruiker kan everyone-intake doen zonder account/eventscontrole',async()=>{
 let writes=0;const x=interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`});
 await createV2Handler(api({intake:async()=>{writes++;return f.intakeResponse;}}),guild,app,async()=>{},()=>{})(x.i);assert.equal(writes,1);assert.match(x.replies.at(-1).content,/Ticket geregistreerd/);
});
test('Ontbrekende optionele keuze wordt als lege array ingestuurd zonder veldfout',async()=>{
 const type=structuredClone(f.typeRevisionResponse.typeRevision);type.questions[2].required=false;let captured:any;
 const x=interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`});x.raw.fields.fields.delete('omgeving');
 await createV2Handler(api({revision:async()=>type,intake:async(_a,_r,_i,answers)=>{captured=answers;return f.intakeResponse;}}),guild,app,async()=>{},()=>{})(x.i);
 assert.deepEqual(captured.omgeving,[]);assert.match(x.replies.at(-1).content,/Ticket geregistreerd/);
});
test('Onverwacht modalveld wordt geweigerd vóór intake en geeft geen actoroverride',async()=>{
 let writes=0;const x=interaction('modal',{customId:`besc:v2:m:${intent}:${revision}`});x.raw.fields.fields.set('discord_user_id',{});
 await createV2Handler(api({intake:async()=>{writes++;return f.intakeResponse;}}),guild,app,async()=>{},()=>{})(x.i);
 assert.equal(writes,0);assert.match(x.replies.at(-1).content,/Controleer/);
});
test('Verlopen lokale intent wordt niet met nieuw venster verlengd',async()=>{
 let clock=Date.now();const handler=createV2Handler(api({intent:async()=>({...f.intentResponse,expiresAt:new Date(clock+10).toISOString()})}),guild,app,async()=>{},()=>{},()=>clock);
 await handler(interaction('select').i);clock+=20;const x=interaction('button',{customId:`besc:v2:f:${intent}:${revision}`});await handler(x.i);assert.equal(x.modals.length,0);assert.match(x.replies.at(-1).content,/verlopen/);
});
test('Meer dan 25 types gebruiken pagina’s zonder nieuwe commandregistratie',async()=>{
 const types=Array.from({length:30},(_,n)=>({...f.typeRevisionResponse.typeRevision,revisionId:`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,name:`TEST ${n}`}));
 const x=interaction('slash');await createV2Handler(api({config:async()=>({...f.configResponse,typeRevisions:types})}),guild,app,async()=>{},()=>{})(x.i);
 assert.equal(x.replies.at(-1).components[0].components[0].options.length,25);assert.equal(x.replies.at(-1).components[1].components[1].disabled,false);
});
test('Ticket bekijken en onbekende interacties blijven bij de bestaande handler',async()=>{
 const handler=createV2Handler(api(),guild,app,async()=>{},()=>{});const x=interaction('slash',{options:{getSubcommandGroup:()=> 'ticket',getSubcommand:()=> 'bekijken'}});
 assert.equal(await handler(x.i),false);assert.equal(await handler(interaction('button',{customId:'another_bot'}).i),false);
});
