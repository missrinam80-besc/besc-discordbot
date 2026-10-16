import test from "node:test";
import assert from "node:assert/strict";
import { renewTicketMenu, ticketMenuBaseId } from "../src/ticket-menu.ts";

const panel='besc:v2:p:20000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000002';
test('Menu-identiteit accepteert alleen canonieke bron plus één strikt begrensde UI-nonce',()=>{
 for(const base of [panel,'besc:v2:choose']){
  assert.equal(ticketMenuBaseId(base),base);assert.equal(ticketMenuBaseId(`${base}:0123456789abcdef`),base);
  for(const suffix of [':',':abc',':0123456789abcdef:extra',':0123456789abcdeg',':0123456789abcdef0'])assert.equal(ticketMenuBaseId(base+suffix),null);
 }
 assert.equal(ticketMenuBaseId('other:v2:choose'),null);assert.equal(ticketMenuBaseId('besc:v2:p:no:uuid'),null);
});

test('Elke reset vervangt row-, component- en custom-ID zonder opties of andere knoppen te veranderen',()=>{
 const rows:any=[{type:1,id:1,components:[{type:3,id:2,custom_id:panel,placeholder:'Kies een tickettype',min_values:1,max_values:1,options:[{label:'TESTFIXTURE',value:'immutable-revision',default:true}]}]},
  {type:1,id:3,components:[{type:2,id:4,custom_id:'other',style:2,label:'Andere knop'}]}];
 const original=structuredClone(rows);let current=rows;
 for(let n=0;n<3;n++){
  const renewed:any=renewTicketMenu(current,panel),before=current[0],after=renewed[0];
  assert.notEqual(after.id,before.id);assert.notEqual(after.components[0].id,before.components[0].id);
  assert.notEqual(after.components[0].custom_id,before.components[0].custom_id);assert.equal(after.components[0].custom_id.length,100);
  assert.equal(ticketMenuBaseId(after.components[0].custom_id),panel);assert.equal(after.components[0].options[0].default,false);
  assert.equal(after.components[0].options[0].value,'immutable-revision');assert.equal(after.components[0].placeholder,'Kies een tickettype');assert.deepEqual(renewed[1],rows[1]);
  const ids=renewed.flatMap((r:any)=>[r.id,...r.components.map((c:any)=>c.id)]);assert.equal(new Set(ids).size,ids.length);
  current=renewed;
 }
 assert.deepEqual(rows,original);
});
