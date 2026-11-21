import { NextRequest } from "next/server";
import { mobileGet,mobilePost,mobilePostOptions,MobileApiError } from "../../../../../lib/mobile-request";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { DEFAULT_ALERT_THRESHOLDS } from "../../../../../lib/report-math";
import { saveReportPreferences } from "../../../../settings/reports/actions";
import { isDocumentRecord } from "../../../../../lib/mobile-document-generation";
export const OPTIONS=mobilePostOptions;
async function settings(){
 const db=await supabaseSession();const {data:{user}}=await db.auth.getUser();const workspaceId=await getActiveWorkspaceId();
 if(!user||!workspaceId)throw new MobileApiError(403,"no_workspace","Select a Space before configuring reports.");
 const {data,error}=await db.from('report_preferences').select('*').eq('workspace_id',workspaceId).eq('user_id',user.id).maybeSingle();
 if(error)throw new Error('Report settings lookup failed');
 const p=data;return {dailyReportEnabled:p?.daily_report_enabled??false,timezone:p?.timezone??'Africa/Kigali',generationTime:(p?.generation_time??'00:05:00').slice(0,5),emailEnabled:p?.email_enabled??false,deliveryTime:(p?.delivery_time??'07:00:00').slice(0,5),deliveryEmail:p?.delivery_email??user.email??'',includeAiAnalysis:p?.include_ai_analysis??false,alertThresholds:{largeTransactionRwf:p?.alert_large_transaction_rwf??DEFAULT_ALERT_THRESHOLDS.largeTransactionRwf,highDailySpendRwf:p?.alert_high_daily_spend_rwf??DEFAULT_ALERT_THRESHOLDS.highDailySpendRwf,elevatedFeesRwf:p?.alert_elevated_fees_rwf??DEFAULT_ALERT_THRESHOLDS.elevatedFeesRwf,lowBalanceRwf:p?p.alert_low_balance_rwf:DEFAULT_ALERT_THRESHOLDS.lowBalanceRwf,sustainedNegativeCashflowDays:p?.alert_sustained_negative_cashflow_days??DEFAULT_ALERT_THRESHOLDS.sustainedNegativeCashflowDays,uncategorizedPercentThreshold:p?.alert_uncategorized_percent??DEFAULT_ALERT_THRESHOLDS.uncategorizedPercentThreshold}};
}
export function GET(request:NextRequest){return mobileGet(request,'report-preferences',async()=>{const p=await settings();return {preferences:{dailyReportEnabled:p.dailyReportEnabled,timezone:p.timezone,generationTime:p.generationTime,emailEnabled:p.emailEnabled,deliveryTime:p.deliveryTime,deliveryEmail:p.deliveryEmail}};});}
export function POST(request:NextRequest){return mobilePost(request,'report-preferences-save',async body=>{
 if(!isDocumentRecord(body)||typeof body.dailyReportEnabled!=='boolean'||typeof body.emailEnabled!=='boolean'||![body.timezone,body.generationTime,body.deliveryTime,body.deliveryEmail].every(v=>typeof v==='string'&&v.length<=254))throw new MobileApiError(400,'invalid_request','Check the report settings.');
 const current=await settings();
 // Preserve AI and all alert settings from the current row; this screen does not edit them.
 const result=await saveReportPreferences({...current,dailyReportEnabled:body.dailyReportEnabled,emailEnabled:body.emailEnabled,timezone:body.timezone as string,generationTime:body.generationTime as string,deliveryTime:body.deliveryTime as string,deliveryEmail:body.deliveryEmail as string});
 return {result:result.ok?result:{ok:false,message:result.error}};
});}
