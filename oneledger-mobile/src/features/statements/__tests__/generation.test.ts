import {fetchDocumentOptions,generateDocument,parseDocumentPreview,previewDocument} from '../generation';
const mockGet=jest.fn(),mockPost=jest.fn();
jest.mock('@/api/bearer',()=>({...jest.requireActual('@/api/bearer'),bearerGet:(...args:unknown[])=>mockGet(...args),bearerPost:(...args:unknown[])=>mockPost(...args)}));
const total={currency:'RWF',openingBalanceMinor:null,closingBalanceMinor:null,totalCreditsMinor:500,totalDebitsMinor:200,totalFeesMinor:20,transactionCount:2,reconciles:null};
const preview={periodLabel:'October',timezone:'Africa/Kigali',statementType:'standard',scope:'all_accounts',totals:[total],warnings:[],adjustments:[],coverageLabel:'Recorded activity',filterSummary:null};
const draft={statementType:'standard' as const,preset:'last_month' as const,timezone:'Africa/Kigali',sourceIds:[],clientToken:'11111111-1111-4111-8111-111111111111'};
beforeEach(()=>{mockGet.mockReset();mockPost.mockReset();});
it('preserves currency totals and unknown balances, rejects malformed or unsafe amounts',()=>{
 expect(parseDocumentPreview(preview)).toEqual(preview);
 expect(parseDocumentPreview({...preview,totals:[{...total,totalCreditsMinor:9007199254740992}]})).toBeNull();
 expect(parseDocumentPreview({...preview,totals:[{...total,totalCreditsMinor:null}]})).toBeNull();
});
it('rejects inaccessible options and incomplete previews without inventing totals',async()=>{
 mockGet.mockResolvedValue({kind:'response',status:200,body:{ok:true,result:{ok:false,message:'No capability'}}});expect(await fetchDocumentOptions()).toEqual({ok:false,message:'No capability'});
 mockPost.mockResolvedValue({kind:'response',status:200,body:{ok:true,result:{ok:true,preview:{}}}});expect((await previewDocument(draft)).ok).toBe(false);
});
it('sends the idempotency token unchanged on repeated generation attempts',async()=>{
 mockPost.mockResolvedValue({kind:'response',status:200,body:{ok:true,result:{ok:true,id:'st1',statementId:'OL-ST-1'}}});await generateDocument(draft);await generateDocument(draft);expect(mockPost.mock.calls[0].slice(0,2)).toEqual(['/api/mobile/statements/generate',{action:'generate',request:draft}]);expect(mockPost.mock.calls[1].slice(0,2)).toEqual(mockPost.mock.calls[0].slice(0,2));
});
