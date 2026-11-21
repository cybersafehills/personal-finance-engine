import {assertEquals} from "jsr:@std/assert@1";
import {parseDocumentRequest} from "./mobile-document-generation.ts";
const valid={statementType:'standard',preset:'last_month',timezone:'Africa/Kigali',sourceIds:[],clientToken:'11111111-1111-4111-8111-111111111111'};
Deno.test('accepts canonical scoped requests and preserves the retry token',()=>{
 const result=parseDocumentRequest({...valid,sourceIds:[valid.clientToken],filters:{direction:'out',category:'Food'}})!;
 assertEquals(result.clientToken,valid.clientToken);assertEquals(result.sourceIds,[valid.clientToken]);assertEquals(result.filters,{direction:'out',category:'Food'});
});
Deno.test('rejects malformed document envelopes before the privileged generator',()=>{
 for(const bad of [null,[],{}, {...valid,clientToken:'bad'}, {...valid,sourceIds:['other']},{...valid,filters:{merchant:42}},{...valid,filters:{direction:'both'}},{...valid,preset:'everything'},{...valid,fromDateKey:15}])assertEquals(parseDocumentRequest(bad),null);
});
