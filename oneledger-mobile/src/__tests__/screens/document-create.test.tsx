import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import Create from '@/app/(app)/statement-create';
import Settings from '@/app/(app)/report-settings';
import {router,resetRouterMock} from '@/test/router-mock';
const mockOptions=jest.fn(),mockPreview=jest.fn(),mockGenerate=jest.fn(),mockPrefs=jest.fn(),mockSave=jest.fn();
jest.mock('expo-router',()=>jest.requireActual('@/test/router-mock'));
jest.mock('@/features/spaces/ActiveSpaceProvider',()=>({useActiveSpace:()=>({activeId:'w1',active:{name:'Personal'}})}));
jest.mock('@/features/statements/generation',()=>({fetchDocumentOptions:()=>mockOptions(),previewDocument:(d:unknown)=>mockPreview(d),generateDocument:(d:unknown)=>mockGenerate(d),fetchReportPreferences:()=>mockPrefs(),saveReportPreferences:(p:unknown)=>mockSave(p)}));
const totals={currency:'RWF',openingBalanceMinor:null,closingBalanceMinor:null,totalCreditsMinor:50000,totalDebitsMinor:10000,totalFeesMinor:200,transactionCount:3,reconciles:null};
beforeEach(()=>{resetRouterMock();[mockOptions,mockPreview,mockGenerate,mockPrefs,mockSave].forEach(m=>m.mockReset());mockOptions.mockResolvedValue({ok:true,value:{timezone:'Africa/Kigali',sources:[{id:'source-1',label:'My MoMo',currency:'RWF'}]}});mockPreview.mockResolvedValue({ok:true,value:{periodLabel:'October 2026',timezone:'Africa/Kigali',scope:'all_accounts',totals:[totals],warnings:['No opening balance available'],adjustments:[],coverageLabel:'Recorded activity',filterSummary:null}});mockGenerate.mockResolvedValue({ok:true,value:{id:'st-1',reference:'OL-ST-1'}});mockPrefs.mockResolvedValue({ok:true,value:{dailyReportEnabled:false,emailEnabled:false,timezone:'Africa/Kigali',generationTime:'00:05',deliveryTime:'07:00',deliveryEmail:'person@example.test'}});mockSave.mockResolvedValue({ok:true,value:true});});
it('reviews canonical totals and generates only after explicit submission with the same request token',async()=>{
 await render(<Create/>);await screen.findByText('Accounts');
 expect(mockGenerate).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByText('Review statement'));
 await screen.findByText('October 2026');expect(screen.getByText('RWF 50,000')).toBeTruthy();expect(screen.getByText('No opening balance available')).toBeTruthy();
 const draft=mockPreview.mock.calls[0][0];expect(draft).toMatchObject({sourceIds:[],preset:'last_month',timezone:'Africa/Kigali'});
 mockGenerate.mockResolvedValueOnce({ok:false,message:'Connection interrupted'});
 await fireEvent.press(screen.getByText('Generate PDF & CSV'));await screen.findByText('Connection interrupted');
 await fireEvent.press(screen.getByText('Generate PDF & CSV'));await screen.findByText('Statement requested');
 expect(mockGenerate.mock.calls.map(c=>c[0].clientToken)).toEqual([draft.clientToken,draft.clientToken]);
 await fireEvent.press(screen.getByText('View statements'));expect(router.replace).toHaveBeenCalledWith('/statements');
});
it('rejects an inverted custom range without sending a preview request',async()=>{
 await render(<Create/>);await screen.findByText('Accounts');await fireEvent.press(screen.getByRole('button',{name:'Custom dates'}));await fireEvent.changeText(screen.getByLabelText('From date'),'2026-11-20');await fireEvent.changeText(screen.getByLabelText('Through date'),'2026-11-01');await fireEvent.press(screen.getByText('Review statement'));expect(await screen.findByText(/Choose valid start/)).toBeTruthy();expect(mockPreview).not.toHaveBeenCalled();
});
it('shows access failures instead of enabling generation',async()=>{
 mockOptions.mockResolvedValue({ok:false,message:'You cannot generate in this Space.'});await render(<Create/>);expect(await screen.findByText('You cannot generate in this Space.')).toBeTruthy();expect(screen.queryByText('Review statement')).toBeNull();
});
it('loads saved schedule settings and writes only on Save',async()=>{
 await render(<Settings/>);await screen.findByLabelText('Daily summaries');expect(mockSave).not.toHaveBeenCalled();await fireEvent(screen.getByLabelText('Daily summaries'),'valueChange',true);await fireEvent.changeText(screen.getByLabelText('Generate at (HH:MM)'),'06:30');await fireEvent.press(screen.getByText('Save schedule'));await screen.findByText('Schedule saved.');expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({dailyReportEnabled:true,generationTime:'06:30',emailEnabled:false}));
});
it('does not save when preference loading failed',async()=>{mockPrefs.mockResolvedValue({ok:false,message:'Settings unavailable'});await render(<Settings/>);await waitFor(()=>expect(screen.getByText('Settings unavailable')).toBeTruthy());expect(screen.queryByText('Save schedule')).toBeNull();});
