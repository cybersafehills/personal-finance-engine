import {fireEvent,render,screen} from '@testing-library/react-native';
import Statements from '@/app/(app)/statements';
import {router,resetRouterMock} from '@/test/router-mock';
const mockList=jest.fn(),mockDownload=jest.fn(),mockOpen=jest.fn();
jest.mock('expo-router',()=>jest.requireActual('@/test/router-mock'));
jest.mock('expo-linking',()=>({openURL:(url:string)=>mockOpen(url)}));
jest.mock('@/api/mobile-api',()=>({fetchStatements:()=>mockList(),fetchStatementDownload:(...args:unknown[])=>mockDownload(...args)}));
const statement={id:'s1',reference:'OL-ST-1',periodLabel:'October 2026',scopeLabel:'Consolidated',typeLabel:'Detailed',status:'ready',transactionCount:201,generatedAt:null,isUpdatedVersion:false,warningCount:1,totals:[{currency:'RWF',openingMinor:null,closingMinor:null,creditsMinor:1353737,debitsMinor:1135958,feesMinor:12260,reconciles:null}]};
beforeEach(()=>{resetRouterMock();mockList.mockResolvedValue({ok:true,enabled:true,statements:[statement]});mockDownload.mockReset().mockResolvedValue({ok:true,url:'https://storage.example.test/fresh.pdf'});mockOpen.mockReset().mockResolvedValue(undefined);});
it('offers creation from a populated history and keeps PDF actions inside details',async()=>{
 await render(<Statements/>);await screen.findByText('October 2026');expect(screen.getByText('RWF 1,353,737')).toBeTruthy();expect(screen.queryByText('PDF')).toBeNull();
 await fireEvent.press(screen.getByText('+ Create statement'));expect(router.push).toHaveBeenLastCalledWith('/statement-create');
 await fireEvent.press(screen.getByText('View details'));await fireEvent.press(screen.getByText('PDF'));expect(mockDownload).toHaveBeenCalledWith('s1','pdf');expect(mockOpen).toHaveBeenCalledWith('https://storage.example.test/fresh.pdf');
 await fireEvent.press(screen.getByText('PDF'));expect(mockDownload).toHaveBeenCalledTimes(2);
});
it('offers a fresh review for failed snapshots without a nonfunctional details button',async()=>{
 mockList.mockResolvedValue({ok:true,enabled:true,statements:[{...statement,status:'failed'}]});await render(<Statements/>);await screen.findByText("Couldn't be generated");expect(screen.queryByText('View details')).toBeNull();await fireEvent.press(screen.getByText('Review a new statement'));expect(router.push).toHaveBeenLastCalledWith('/statement-create');
});
