import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEventJob } from '../src/event-sync-api.ts';
import { createEventSyncDiscord } from '../src/event-sync-discord.ts';
import { createEventInterestWorker } from '../src/event-interest-worker.ts';
import { loadConfig } from '../src/config.ts';
const guild='1067893182387474432',bot='111111111111111111',remote='222222222222222222',pub='00000000-0000-4000-8000-000000000004';
const origin='https://cc.example.invalid',payload={name:'Community event',description:`Public text\n\nMeer informatie en aanmelden: ${origin}/events/aanmelden/${pub}`,scheduled_start_time:'2035-06-01T16:00:00Z',scheduled_end_time:'2035-06-01T19:00:00Z',privacy_level:2,entity_type:3,channel_id:null,entity_metadata:{location:'Gistel'}};
const config={token:'NOT_A_REAL_TOKEN',guildId:guild,applicationId:bot,apiUrl:origin+'/api/v1/bot/'};
const event={...payload,id:remote,guild_id:guild,creator_id:bot,status:1};
test('Job decoder binds guild, public reference and minimal frozen fields',()=>{
 const j={id:pub,publication_id:pub,event_id:pub,lease_token:pub,lease_until:'2035-06-01T12:00:00Z',guild_id:guild,revision:1,operation:'upsert',discord_event_id:null,payload};
 assert.equal(decodeEventJob(j,guild,origin)?.publication_id,pub);
 for(const v of [{...j,guild_id:bot},{...j,payload:{...payload,private_notes:'secret'}},{...j,payload:{...payload,description:payload.description.replace(origin,'https://evil.invalid')}}])assert.throws(()=>decodeEventJob(v,guild,origin));
});
test('Discord sender has bounded requests, one mutation attempt and a rate cooldown',async()=>{
 let calls=0;const f=(async(_url,init)=>{calls++;assert.equal(init?.redirect,'error');return Response.json({retry_after:30},{status:429});})as typeof fetch;
 const d=createEventSyncDiscord(config,f,()=>1000);await assert.rejects(d.create(payload as never));await assert.rejects(d.create(payload as never));assert.equal(calls,1);
});
test('Remote ownership and exact public link are used to find an uncertain event',async()=>{
 const d=createEventSyncDiscord(config,(async()=>Response.json([event,{...event,id:'333333333333333333',creator_id:'444444444444444444'}]))as typeof fetch);
 assert.deepEqual((await d.findByReference(pub)).map(x=>x.id),[remote]);
});
test('Interested user pagination submits IDs only and refuses duplicate or partial pages',async()=>{
 const ids=Array.from({length:100},(_,i)=>(333333333333333333n+BigInt(i)).toString());let page=0;
 const d=createEventSyncDiscord(config,(async url=>{
  if(!String(url).includes('/users?'))return Response.json(event);
  page++;return Response.json(page===1?ids.map(id=>({guild_scheduled_event_id:remote,user:{id,username:'PRIVATE_NAME'}})):[]);
 })as typeof fetch);assert.deepEqual(await d.interestedUsers(remote,pub),ids);assert.equal(page,2);
 const bad=createEventSyncDiscord(config,(async url=>Response.json(String(url).includes('/users?')?[{guild_scheduled_event_id:remote,user:{id:ids[0]}},{guild_scheduled_event_id:remote,user:{id:ids[0]}}]:event))as typeof fetch);
 await assert.rejects(bad.interestedUsers(remote,pub));
});
test('Failed or incomplete interest collection never replaces the stored snapshot',async()=>{
 let writes=0;const w=createEventInterestWorker({interestTargets:async()=>[{publication_id:pub,discord_event_id:remote}],interestSnapshot:async()=>{writes++;}}, {interestedUsers:async()=>{throw Error('partial_page');}});
 await Promise.all([w.tick(),w.tick()]);await w.stop();await w.tick();assert.equal(writes,0);
});
test('Both new bot features default off and require durable state and separate flags',()=>{
 const env={DISCORD_BOT_TOKEN:'fixture',DISCORD_APPLICATION_ID:bot,DISCORD_GUILD_ID:guild,COMMANDCENTER_API_URL:config.apiUrl,COMMANDCENTER_WEB_URL:origin,BESC_BOT_API_KEY:'bb_fixture.'+'a'.repeat(43)};
 assert.equal(loadConfig(env).eventSyncEnabled,undefined);
 assert.throws(()=>loadConfig({...env,BESC_DISCORD_EVENT_INTEREST_ENABLED:'true'}));
 assert.throws(()=>loadConfig({...env,BESC_DISCORD_EVENTS_ENABLED:'true'}));
 assert.equal(loadConfig({...env,BESC_DISCORD_EVENTS_ENABLED:'true',BESC_BOT_STATE_DIR:process.cwd()}).eventSyncEnabled,true);
});
