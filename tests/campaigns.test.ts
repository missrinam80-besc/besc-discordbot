import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { createCampaignApi, type CampaignPage } from '../src/campaign-api.ts';
import { createCampaignHandler, type CampaignInteraction } from '../src/campaign-handler.ts';
import { createBescCommand } from '../src/commands.ts';
import { loadConfig } from '../src/config.ts';
const guild='111111111111111111', actor='222222222222222222', id='30000000-0000-4000-8000-000000000001';
const config={apiUrl:'http://127.0.0.1/api/v1/bot/',apiKey:`bb_fixture-campaign.${'a'.repeat(43)}`,guildId:guild};
const page:CampaignPage={campaigns:[{id,title:'TESTFIXTURE @everyone https://evil.invalid <@123> [x](url)',synthetic:true,path:`/app/campagnes/${id}/proef`}],nextOffset:null};
function input(guildId:string|null=guild):CampaignInteraction {
  return {id:'campaign-interaction',commandName:'besc',guildId,user:{id:actor},options:{getSubcommandGroup:()=> 'campagne',getSubcommand:()=> 'mijn',getInteger:()=> null},
    async deferReply({flags}){assert.equal(flags,MessageFlags.Ephemeral);},async editReply(){}};
}
test('Own campaign transport binds actor and guild, rejects private fields and off-origin paths',async()=>{
 let url=''; const api=createCampaignApi(config,async u=>{url=String(u);return Response.json({schemaVersion:1,...page});});
 const result=await api.own(actor,0);assert.equal(result.campaigns[0].id,id);assert.equal(new URL(url).searchParams.get('discord_user_id'),actor);assert.equal(new URL(url).searchParams.get('guild_id'),guild);
 for(const change of [{...page,campaigns:[{...page.campaigns[0],path:'https://evil.invalid'}]}, {...page,campaigns:[{...page.campaigns[0],email:'hidden'}]}, {...page,nextOffset:99999}]) {
   await assert.rejects(createCampaignApi(config,async()=>Response.json({schemaVersion:1,...change})).own(actor,0),/invalid_response/);
 }
});
test('Handler stays private, neutralizes titles and only links to configured CC origin',async()=>{
 let reads=0,text='';const handler=createCampaignHandler({async own(a,n){assert.equal(a,actor);assert.equal(n,0);reads++;return page;}},{guildId:guild,webUrl:'https://cc.example.invalid/'});
 const i=input();i.editReply=async r=>{text=r.content;assert.deepEqual(r.allowedMentions,{parse:[]});};await handler(i);await handler(i);
 assert.equal(reads,1);assert(!text.includes('@everyone'));assert(!text.includes('https://evil.invalid'));assert.match(text,/https:\/\/cc\.example\.invalid\/app\/campagnes\//);assert(text.length<2000);
});
test('Wrong guild or DM does not query campaigns',async()=>{
 let reads=0;
 for(const guildId of [null,'333333333333333333'])await createCampaignHandler({async own(){reads++;return page;}},{guildId:guild,webUrl:'https://cc.example.invalid'})(input(guildId));
 assert.equal(reads,0);
});
test('Five long unsafe titles remain a bounded private Discord response',async()=>{
 const rows=Array.from({length:5},(_,n)=>({...page.campaigns[0],id:`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`,title:'*'.repeat(160)}));
 const i=input();let text='';i.editReply=async r=>{text=r.content;};
 await createCampaignHandler({async own(){return{campaigns:rows,nextOffset:5};}},{guildId:guild,webUrl:'https://cc.example.invalid'})(i);
 assert(text.length<1900);assert(text.includes('pagina:2'));
});
test('Campaign commands default off and preserve existing command groups when opted in',()=>{
 const old=createBescCommand(true,true).toJSON().options??[], expanded=createBescCommand(true,true,true).toJSON().options??[];
 assert(!old.some(o=>o.name==='campagne'));assert.deepEqual(expanded.filter(o=>o.name!=='campagne'),old);
 const env={DISCORD_BOT_TOKEN:'TESTFIXTURE',DISCORD_APPLICATION_ID:guild,DISCORD_GUILD_ID:guild,COMMANDCENTER_API_URL:config.apiUrl,COMMANDCENTER_WEB_URL:'https://cc.example.invalid',BESC_BOT_API_KEY:config.apiKey};
 assert.equal(loadConfig(env).campaignsEnabled,undefined);assert.equal(loadConfig({...env,BESC_CAMPAIGN_COMMANDS_ENABLED:'true'}).campaignsEnabled,true);
 assert.throws(()=>loadConfig({...env,BESC_CAMPAIGN_COMMANDS_ENABLED:'yes'}));
});
test('Submission is separately enabled, binds campaign origin and keeps original interaction id',async()=>{
 let writes=0,key='';const api={async own(){return page;},async submit(a:string,c:string,url:string,k:string){writes++;assert.equal(a,actor);assert.equal(c,id);assert.equal(url,'https://clips.twitch.tv/TESTFIXTURE');key=k;return{contributionId:id,status:'candidate',replay:false};}};
 const i=input();i.id='111111111111111111';i.options.getSubcommand=()=> 'indienen';i.options.getString=name=>name==='campagne'?`https://cc.example.invalid/app/campagnes/${id}/proef`:'https://clips.twitch.tv/TESTFIXTURE';let text='';i.editReply=async r=>{text=r.content;assert.deepEqual(r.allowedMentions,{parse:[]});};
 await createCampaignHandler(api,{guildId:guild,webUrl:'https://cc.example.invalid'})(i);assert.equal(writes,0);
 await createCampaignHandler(api,{guildId:guild,webUrl:'https://cc.example.invalid',submissionsEnabled:true})(i);assert.equal(writes,1);assert.equal(key,i.id);assert(text.includes('geen beloning'));
 i.options.getString=name=>name==='campagne'?`https://evil.invalid/app/campagnes/${id}/proef`:'https://clips.twitch.tv/TESTFIXTURE';
 await createCampaignHandler(api,{guildId:guild,webUrl:'https://cc.example.invalid',submissionsEnabled:true})(i);assert.equal(writes,1);
 const command=createBescCommand(true,true,true,true).toJSON();assert(command.options?.some(o=>o.name==='campagne'&&'options' in o&&o.options?.some(s=>s.name==='indienen')));
});
