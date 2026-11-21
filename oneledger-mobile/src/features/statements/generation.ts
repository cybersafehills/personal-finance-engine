import { bearerGet,bearerPost,failureForOutcome,failureForStatus } from "@/api/bearer";
export type StatementDraft={statementType:"standard"|"detailed";preset:"this_month"|"last_month"|"last_3_months"|"last_6_months"|"last_12_months"|"custom";timezone:string;sourceIds:string[];clientToken:string;fromDateKey?:string;toDateKey?:string;filters?:{direction?:"in"|"out";category?:string;merchant?:string}};
export type DocumentOptions={sources:{id:string;label:string;currency:string}[];timezone:string};
export type PreviewTotal={currency:string;openingBalanceMinor:number|null;closingBalanceMinor:number|null;totalCreditsMinor:number;totalDebitsMinor:number;totalFeesMinor:number;transactionCount:number;reconciles:boolean|null};
export type DocumentPreview={periodLabel:string;timezone:string;statementType:string;scope:string;totals:PreviewTotal[];warnings:string[];coverageLabel:string;adjustments:string[];filterSummary:string|null};
export type Result<T>={ok:true;value:T}|{ok:false;message:string};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const amount=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v);
export function parseDocumentPreview(v:unknown):DocumentPreview|null{
 if(!record(v)||typeof v.periodLabel!=='string'||typeof v.timezone!=='string'||typeof v.coverageLabel!=='string'||!strings(v.warnings)||!strings(v.adjustments)||!Array.isArray(v.totals))return null;
 if(!v.totals.every(t=>record(t)&&typeof t.currency==='string'&&[t.openingBalanceMinor,t.closingBalanceMinor].every(amount)&&[t.totalCreditsMinor,t.totalDebitsMinor,t.totalFeesMinor,t.transactionCount].every(x=>typeof x==='number'&&Number.isSafeInteger(x))))return null;
 return v as unknown as DocumentPreview;
}
async function request<T>(path:string,body:unknown|undefined,parse:(v:Record<string,unknown>)=>T|null):Promise<Result<T>>{
 let r:Awaited<ReturnType<typeof bearerGet>>;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),body===undefined?30000:75000);
 try{r=body===undefined?await bearerGet(path,controller.signal):await bearerPost(path,body,controller.signal);}catch{return {ok:false,message:"Couldn’t connect. Check your connection and try again."};}finally{clearTimeout(timeout);}
 if(r.kind!=='response')return {ok:false,message:failureForOutcome(r,'Documents').message};
 if(r.status!==200)return {ok:false,message:record(r.body)&&typeof r.body.message==='string'?r.body.message:failureForStatus(r.status,'Documents').message};
 if(!record(r.body)||r.body.ok!==true)return {ok:false,message:'Couldn’t read the document response.'};
 const result=r.body.result;
 if(record(result)&&result.ok===false)return {ok:false,message:typeof result.message==='string'?result.message:'This action is unavailable.'};
 const value=parse(r.body);return value===null?{ok:false,message:'The server returned incomplete document data.'}:{ok:true,value};
}
export const fetchDocumentOptions=()=>request<DocumentOptions>('/api/mobile/statements/generate',undefined,b=>{
 const r=b.result;if(!record(r)||r.ok!==true||!Array.isArray(r.sources)||typeof r.timezone!=='string'||!r.sources.every(s=>record(s)&&typeof s.id==='string'&&typeof s.label==='string'&&typeof s.currency==='string'))return null;return {sources:r.sources as DocumentOptions['sources'],timezone:r.timezone};
});
export const previewDocument=(draft:StatementDraft)=>request('/api/mobile/statements/generate',{action:'preview',request:draft},b=>record(b.result)?parseDocumentPreview(b.result.preview):null);
export const generateDocument=(draft:StatementDraft)=>request('/api/mobile/statements/generate',{action:'generate',request:draft},b=>record(b.result)&&b.result.ok===true&&typeof b.result.id==='string'&&typeof b.result.statementId==='string'?{id:b.result.id,reference:b.result.statementId}:null);
export type ReportPreferences={dailyReportEnabled:boolean;timezone:string;generationTime:string;emailEnabled:boolean;deliveryTime:string;deliveryEmail:string};
export const fetchReportPreferences=()=>request<ReportPreferences>('/api/mobile/reports/preferences',undefined,b=>{
 const p=b.preferences;if(!record(p)||typeof p.dailyReportEnabled!=='boolean'||typeof p.emailEnabled!=='boolean'||![p.timezone,p.generationTime,p.deliveryTime,p.deliveryEmail].every(x=>typeof x==='string'))return null;return p as ReportPreferences;
});
export const saveReportPreferences=(p:ReportPreferences)=>request('/api/mobile/reports/preferences',p,b=>record(b.result)&&b.result.ok===true?true:null);
