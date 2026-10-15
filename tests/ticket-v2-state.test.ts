import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,rmdir}from'node:fs/promises';
import {tmpdir}from'node:os';
import {join}from'node:path';
import {FileV2State}from'../src/ticket-v2-state.ts';
import {createTicketApi}from'../src/ticket-api.ts';
const guild='1067893182387474432',app='1558542661265129474',old='1558853872766689382',other='222222222222222222',id='20000000-0000-4000-8000-000000000001';
test('Duurzaam register bewaart oude en nieuwe parents over restart zonder antwoorden of credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'besc-v2-test-')),path=join(dir,`${guild}-${app}.json`);
 try{const first=new FileV2State(dir,guild,app);await first.load();await Promise.all([first.parent(old),first.parent(other)]);
  await first.remember(id,{guild,channel:old,message:'111111111111111111',payloadHash:'a'.repeat(64),marker:`besc-panel-${id}`});
  const second=new FileV2State(dir,guild,app);await second.load();assert.deepEqual(second.parents().sort(),[old,other].sort());assert.equal(second.effect(id)?.message,'111111111111111111');
  const text=await readFile(path,'utf8');assert.doesNotMatch(text,/apiKey|token|answers|omschrijving/);await second.forget(id);const third=new FileV2State(dir,guild,app);await third.load();assert.equal(third.effect(id),undefined);assert.equal(third.parents().length,2);
 }finally{await rm(path,{force:true});await rm(path+'.next',{force:true});await rmdir(dir);}
});
test('Beschadigd journal wordt geweigerd; parenthistoriek wordt niet stil gewist',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'besc-v2-test-')),path=join(dir,`${guild}-${app}.json`);
 try{await writeFile(path,'{"parents":["bad"],"effects":{}}');await assert.rejects(new FileV2State(dir,guild,app).load());}finally{await rm(path,{force:true});await rmdir(dir);}
});
test('Andere opgeslagen parent uit geauthenticeerde CC-delivery is alleen toegestaan in expliciete V2-context',async()=>{
 const marker=`besc-ticket-${id}`,delivery={id,ticketId:id,kind:'close_thread',payload:{},guildId:guild,parentChannelId:other,threadId:'111111111111111111',ticketStatus:'closed',ticketMarker:marker,leaseToken:id,leasedUntil:new Date(Date.now()+60000).toISOString(),reconcile:false,nonce:'1',allowedMentions:{parse:[]}};
 const config={apiUrl:'https://fixture.invalid/api/v1/bot/',apiKey:`bb_fixture.${'a'.repeat(43)}`,guildId:guild,ticketParentChannelId:old};const fetcher=(async()=>Response.json({deliveries:[delivery]}))as typeof fetch;
 await assert.rejects(createTicketApi(config,fetcher).claim('worker_123'));assert.equal((await createTicketApi({...config,storedParentBindings:true},fetcher).claim('worker_123'))[0].parentChannelId,other);
 delivery.guildId=other;await assert.rejects(createTicketApi({...config,storedParentBindings:true},fetcher).claim('worker_123'));
});
