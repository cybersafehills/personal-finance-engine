import { kigaliDateKey,kigaliDayBoundsUtc } from "@/lib/kigali-time";
import type { TrendPoint } from "./Charts";
export type TrendRange={kind:"months";months:1|3|6|12}|{kind:"custom";from:string;to:string};
export type TrendWindow={from:string;to:string;granularity:"day"|"week"|"month";label:string};
const DAY=86400000;
function validKey(key:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;const d=new Date(key+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===key;}
export function trendWindow(range:TrendRange,now:Date):TrendWindow {
 const today=kigaliDateKey(now.toISOString());let from:string,to:string,label:string;
 if(range.kind==="months"){
  const [y,m]=today.split("-").map(Number);from=new Date(Date.UTC(y,m-range.months,1)-7200000).toISOString();to=now.toISOString();label=`${range.months} month${range.months===1?"":"s"}`;
 }else{
  if(!validKey(range.from)||!validKey(range.to)||range.from>range.to)throw new Error("Enter valid dates in YYYY-MM-DD order.");
  if(range.to>today)throw new Error("Choose an end date on or before today.");
  from=kigaliDayBoundsUtc(range.from).startUtc.toISOString();to=new Date(Math.min(kigaliDayBoundsUtc(range.to).endUtc.getTime()+1,now.getTime())).toISOString();label="Custom dates";
 }
 const days=(Date.parse(to)-Date.parse(from))/DAY;
 if(days<=0||days>400)throw new Error("Choose a range of up to 400 days.");
 return {from,to,label,granularity:days<=45?"day":days<=120?"week":"month"};
}
export function fillTrendWindow(points:TrendPoint[],window:TrendWindow):TrendPoint[]{
 const start=kigaliDateKey(window.from),end=kigaliDateKey(new Date(Date.parse(window.to)-1).toISOString());
 const cursor=new Date(start+"T00:00:00Z");
 if(window.granularity==="month")cursor.setUTCDate(1);
 if(window.granularity==="week")cursor.setUTCDate(cursor.getUTCDate()-(cursor.getUTCDay()+6)%7);
 const byKey=new Map(points.map(p=>[p.bucketStart,p]));const rows:TrendPoint[]=[];
 for(let i=0;i<402;i++){
  const key=cursor.toISOString().slice(0,10);if(key>end)break;
  rows.push(byKey.get(key)??{bucketStart:key,moneyInMinor:0n,moneyOutMinor:0n,netMinor:0n});
  if(window.granularity==="month")cursor.setUTCMonth(cursor.getUTCMonth()+1);else cursor.setUTCDate(cursor.getUTCDate()+(window.granularity==="week"?7:1));
 }
 return rows;
}
