import test from 'node:test';import assert from'node:assert/strict';
import {Collection,ChannelType,PermissionFlagsBits,PermissionsBitField,type Client,type Message}from'discord.js';
import {createTicketContexts}from'../src/ticket-contexts.ts';
import type{Delivery}from'../src/ticket-api.ts';import type{V2State}from'../src/ticket-v2-state.ts';
const guild='1067893182387474432',app='1558542661265129474',legacy='1558853872766689382',saved='222222222222222222',user='333333333333333333',threadId='444444444444444444',id='20000000-0000-4000-8000-000000000001';
test('Bestaande typed thread blijft importeren, sluiten en verwijderen via opgeslagen parent na configuratiewijziging',async()=>{
 const known=new Set([legacy,saved]);const state:V2State={parents:()=>[...known],parent:async p=>{known.add(p);},effect:()=>undefined,remember:async()=>{}};
 const permissions=new PermissionsBitField(Object.values(PermissionFlagsBits));let edits=0,deletes=0;
 const thread:any={id:threadId,guildId:guild,parentId:saved,type:ChannelType.PrivateThread,name:`besc-ticket-${id}`,ownerId:app,invitable:false,archived:false,
  edit:async(data:any)=>{edits++;assert.deepEqual(data,{locked:true,archived:true});},delete:async()=>{deletes++;}};
 const parent:any={id:saved,guildId:guild,type:ChannelType.GuildText,permissionsFor:()=>permissions,guild:{members:{fetch:async()=>({user:{bot:false}})}},
  threads:{fetchActive:async()=>({threads:new Collection([[threadId,thread]])}),fetchArchived:async()=>({threads:new Collection(),hasMore:false})}};
 const client:any={user:{id:app},channels:{fetch:async(channel:string)=>{assert.equal(channel,saved);return parent;}},rest:{get:async()=>[{user_id:user}]}};
 const requests:any[]=[];let status='open';const fetcher=(async(url:any,init:any)=>{requests.push({url:String(url),body:init?.body?JSON.parse(init.body):null});return Response.json(init?.body?{ticketId:id,messageId:id}:{ticketId:id,status,linkStatus:'linked',threadId});})as typeof fetch;
 const contexts=createTicketContexts(client as Client,{apiUrl:'https://fixture.invalid/api/v1/bot/',apiKey:`bb_fixture.${'a'.repeat(43)}`,guildId:guild,ticketParentChannelId:legacy},()=>{},state,fetcher);
 await contexts.message({id:'555555555555555555',guildId:guild,channel:thread,author:{id:user,bot:false},webhookId:null,content:'TEST saved parent'} as unknown as Message);
 assert.equal(requests.at(-1).body.parent_channel_id,saved);assert.equal(requests.at(-1).body.discord_user_id,user);
 const delivery:Delivery={id,ticketId:id,kind:'close_thread',payload:{},guildId:guild,parentChannelId:saved,threadId,ticketStatus:'closed',ticketMarker:thread.name,leaseToken:id,leasedUntil:new Date(Date.now()+60000).toISOString(),reconcile:false,nonce:'1'};
 status='closed';await contexts.execute(delivery);await contexts.execute({...delivery,kind:'delete_thread'});assert.equal(edits,1);assert.equal(deletes,1);
 const count=requests.length;await contexts.message({id:'555555555555555555',guildId:guild,channel:{...thread,parentId:'666666666666666666'},author:{id:user,bot:false},webhookId:null,content:'Unrelated'} as unknown as Message);assert.equal(requests.length,count);
});
