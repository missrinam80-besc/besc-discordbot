import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer}from'node:http';
import {readFileSync}from'node:fs';
import {createV2Api}from'../src/ticket-v2-api.ts';
const f=JSON.parse(readFileSync(new URL('./fixtures/ticketing-v2.fixtures.json',import.meta.url),'utf8'));
test('Lokale HTTP-proef: verlies van intent/intake-response houdt dezelfde keys en precies één fixture-effect',async()=>{
 const key=`bb_fixture.${'a'.repeat(43)}`,journal=new Map<string,{body:string;result:unknown}>();let intents=0,tickets=0;
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,`Bearer ${key}`);const chunks:Buffer[]=[];for await(const part of req)chunks.push(part);const body=Buffer.concat(chunks).toString();
  const path=req.url!,idem=String(req.headers['idempotency-key']),storage=path+':'+idem,old=journal.get(storage);
  if(old){assert.equal(old.body,body);res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify(old.result));return;}
  const response=path.endsWith('ticket-intents')?f.intentResponse:f.intakeResponse;if(path.endsWith('ticket-intents'))intents++;else tickets++;
  journal.set(storage,{body,result:response});req.socket.destroy();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
 try{const api=createV2Api({apiUrl:`http://127.0.0.1:${address.port}/api/v1/bot/`,apiKey:key,guildId:f.configResponse.guildId,applicationId:f.publicationDelivery.payload.applicationId});
  const intent=await api.intent('111111111111111111',f.intentResponse.typeRevisionId,{source:'slash'},'111111111111111111');
  const result=await api.intake('111111111111111111',intent.typeRevisionId,intent.intentId,{onderwerp:'TESTFIXTURE',omschrijving:'Private test',omgeving:['discord']},'222222222222222222');
  assert.equal(result.ticketId,f.intakeResponse.ticketId);assert.equal(intents,1);assert.equal(tickets,1);assert.equal(journal.size,2);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
