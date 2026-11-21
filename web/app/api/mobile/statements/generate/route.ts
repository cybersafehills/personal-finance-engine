import { NextRequest } from "next/server";
import { mobileGet,mobilePost,mobilePostOptions,MobileApiError } from "../../../../../lib/mobile-request";
import { isFinancialStatementsEnabled } from "../../../../../lib/financial-statements";
import { documentPreview,isDocumentRecord,parseDocumentRequest } from "../../../../../lib/mobile-document-generation";
export const OPTIONS=mobilePostOptions;
export const maxDuration=60;
function available(){if(!isFinancialStatementsEnabled())throw new MobileApiError(404,"unavailable","Statements aren't available right now.");}
export function GET(request:NextRequest){return mobileGet(request,"statement-options",async()=>{available();const {getStatementFormOptions}=await import("../../../../../lib/statement-generation");return {result:await getStatementFormOptions()};});}
export function POST(request:NextRequest){return mobilePost(request,"statement-generate",async body=>{
 available();
 if(!isDocumentRecord(body)||!['preview','generate'].includes(String(body.action)))throw new MobileApiError(400,"invalid_request","Choose preview or generate.");
 const input=parseDocumentRequest(body.request);if(!input)throw new MobileApiError(400,"invalid_request","Check the statement details and try again.");
 const {previewStatement,createStatement}=await import("../../../../../lib/statement-generation");
 if(body.action==='preview'){const result=await previewStatement(input);return {result:result.ok?{ok:true,preview:documentPreview(result.preview)}:result};}
 return {result:await createStatement(input)};
});}
