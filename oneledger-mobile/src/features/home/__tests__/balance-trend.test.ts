import { historicalBalanceWindow,loadRecordedBalanceTrend,type BalanceTrendInput } from "../balance-trend";
const mockCalls:unknown[][]=[];
let mockRows:Record<string,unknown>[]=[];
let mockError:unknown=null;
jest.mock("@/api/supabase",()=>({supabase:{from:(table:string)=>{
 mockCalls.push(["from",table]);const chain:Record<string,unknown>={};
 for (const method of ["select","eq","neq","not","gte","lte","order","limit"]) chain[method]=(...args:unknown[])=>{mockCalls.push([method,...args]);return chain;};
 chain.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:mockRows,error:mockError}).then(resolve);
 return chain;
}}}));
const input:BalanceTrendInput={workspaceId:"w1",accountId:"momo",currency:"RWF",currentMinor:10000n,currentAsOf:"2026-11-19T06:47:00Z",status:"confirmed",basis:"provider_reported"};
const row=(amount:unknown,asOf="2026-10-18T06:47:00Z",extra:Record<string,unknown>={})=>({balance_after_rwf:amount,occurred_at:asOf,direction:"out",principal_effect_rwf:-10,...extra});
beforeEach(()=>{mockCalls.length=0;mockRows=[];mockError=null;});
it("compares exact recorded amounts from the same wallet, Space and currency",async()=>{
 mockRows=[row("8000")];
 expect(await loadRecordedBalanceTrend(input)).toMatchObject({accountId:"momo",currentMinor:10000n,previousMinor:8000n,deltaBps:2500,previousAsOf:"2026-10-18T06:47:00Z"});
 for (const c of [["eq","workspace_id","w1"],["eq","account_id","momo"],["eq","currency","RWF"],["eq","settlement_state","settled"],["neq","dedupe_state","merged"],["lte","occurred_at","2026-10-19T06:47:00.000Z"],["gte","occurred_at","2026-10-12T06:47:00.000Z"]]) expect(mockCalls).toContainEqual(c);
});
it("does not compare estimated/stale/manual balances or an unknown Space",async()=>{
 for (const override of [{status:"estimated"},{status:"stale"},{basis:"manual"},{workspaceId:null},{currentMinor:null},{currentAsOf:"bad"}]) expect(await loadRecordedBalanceTrend({...input,...override})).toBeNull();
 expect(mockCalls).toHaveLength(0);
});
it("does not use zero/negative baselines or substitute an older positive one",async()=>{
 for (const amount of [0,-100]) {mockRows=[row(amount),row(5000,"2026-10-17T06:47:00Z")];expect(await loadRecordedBalanceTrend(input)).toBeNull();}
});
it("skips impossible received balances and rejects out-of-window snapshots",async()=>{
 mockRows=[row(100,"2026-10-19T06:47:00Z",{direction:"in",principal_effect_rwf:200}),row(8000,"2026-09-01T00:00:00Z")];
 expect(await loadRecordedBalanceTrend(input)).toBeNull();
});
it("keeps precise string minor units and surfaces query failures",async()=>{
 mockRows=[row("9007199254740993")];
 expect((await loadRecordedBalanceTrend({...input,currentMinor:9007199254740993n}))?.deltaBps).toBe(0);
 mockError={message:"offline"};await expect(loadRecordedBalanceTrend(input)).rejects.toThrow("unavailable");
});
it("uses Kigali calendar boundaries including January and short months",()=>{
 expect(historicalBalanceWindow("2026-01-01T01:00:00Z")).toEqual({from:"2025-11-30T22:00:00.000Z",to:"2025-12-01T01:00:00.000Z"});
 expect(historicalBalanceWindow("2026-03-31T10:00:00Z")?.to).toBe("2026-02-28T22:00:00.000Z");
});
