import {fillTrendWindow,trendWindow} from "../trend-range";
const now=new Date("2026-11-21T10:00:00Z");
it("supports twelve months and adaptive day/week/month buckets",()=>{
 expect(trendWindow({kind:"months",months:12},now)).toMatchObject({from:"2025-11-30T22:00:00.000Z",granularity:"month"});
 expect(trendWindow({kind:"months",months:1},now).granularity).toBe("day");
 expect(trendWindow({kind:"months",months:3},now).granularity).toBe("week");
});
it("includes the selected end day and rejects invalid, future or oversized ranges",()=>{
 expect(trendWindow({kind:"custom",from:"2026-11-01",to:"2026-11-20"},now)).toMatchObject({from:"2026-10-31T22:00:00.000Z",to:"2026-11-20T22:00:00.000Z"});
 for(const range of [{from:"2026-02-30",to:"2026-11-20"},{from:"2026-11-21",to:"2026-11-20"},{from:"2026-01-01",to:"2027-01-01"},{from:"2024-01-01",to:"2026-11-20"}])expect(()=>trendWindow({kind:"custom",...range},now)).toThrow();
});
it("fills only the successfully requested window, including a partial week",()=>{
 const w=trendWindow({kind:"custom",from:"2026-11-01",to:"2026-11-03"},now);
 const point={bucketStart:"2026-11-02",moneyInMinor:10n,moneyOutMinor:2n,netMinor:8n};
 expect(fillTrendWindow([point],w).map(p=>[p.bucketStart,p.moneyInMinor])).toEqual([["2026-11-01",0n],["2026-11-02",10n],["2026-11-03",0n]]);
 expect(fillTrendWindow([],{...w,granularity:"week"}).map(p=>p.bucketStart)).toEqual(["2026-10-26","2026-11-02"]);
});
