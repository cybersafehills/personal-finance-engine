import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import Guides from "@/app/(app)/guides";
import { GuidesContext, type GuidesContextValue } from "../context";
import { guideDefinitions } from "../definitions";
import { emptyGuides } from "../model";
const mockStart=jest.fn(),mockWelcome=jest.fn(),mockSetCompact=jest.fn();
let mockPay=false;
jest.mock('expo-router',()=>jest.requireActual('@/test/router-mock'));
jest.mock('@/features/auth/SessionProvider',()=>({useSession:()=>({session:null})}));
jest.mock('@/features/capture/capture',()=>({captureSupported:false}));
jest.mock('@/components/shell/NavigationChromeContext',()=>({useNavigationChrome:()=>({payOn:mockPay,setCompact:mockSetCompact,onTabs:false})}));
jest.mock('@/features/spaces/ActiveSpaceProvider',()=>({useActiveSpace:()=>({spaces:[{id:'personal'}]})}));
const context=():GuidesContextValue=>({ready:true,state:{...emptyGuides(),progress:{orientation:{status:'paused',step:1},transaction:{status:'completed',step:1}}},definitions:guideDefinitions(false),active:false,notice:null,register:()=>()=>{},start:mockStart,offerWelcome:mockWelcome,considerWelcome:()=>{},pause:()=>{},claimSuggestion:()=>false,dismissSuggestion:()=>{}});
afterEach(()=>jest.restoreAllMocks());
beforeEach(()=>{jest.replaceProperty(Platform,"OS","android");mockStart.mockReset();mockWelcome.mockReset();mockPay=false;});
it('offers a resume and a replay without resetting account setup',async()=>{
  await render(<GuidesContext.Provider value={context()}><Guides/></GuidesContext.Provider>);
  expect(screen.getByText('Resume')).toBeTruthy();
  await fireEvent.press(screen.getByText('Your first look'));expect(mockStart).toHaveBeenCalledWith('orientation');
  await fireEvent.press(screen.getByRole('button',{name:'Track & understand'}));
  await fireEvent.press(screen.getByText('Find a transaction'));expect(mockStart).toHaveBeenCalledWith('transaction');
});
it('does not activate unavailable Pay, recording or shared-Space guides',async()=>{
  await render(<GuidesContext.Provider value={context()}><Guides/></GuidesContext.Provider>);
  await fireEvent.press(screen.getByRole('button',{name:'Pay & request'}));
  await fireEvent.press(screen.getByRole('button',{name:'Records & preferences'}));
  expect(screen.getAllByText('Pay is unavailable in this Space').length).toBeGreaterThan(0);
  expect(screen.getByText('Requires a supported phone')).toBeTruthy();
  expect(screen.getByText('Available when you join another Space')).toBeTruthy();
  await fireEvent.press(screen.getByText('Find the Pay tools'));expect(mockStart).not.toHaveBeenCalled();
});
it('allows an explicitly enabled Pay guide and welcome replay',async()=>{
  mockPay=true;
  await render(<GuidesContext.Provider value={context()}><Guides/></GuidesContext.Provider>);
  await fireEvent.press(screen.getByRole('button',{name:'Pay & request'}));
  await fireEvent.press(screen.getByText('Find the Pay tools'));expect(mockStart).toHaveBeenCalledWith('pay');
  await fireEvent.press(screen.getByText('Replay the welcome'));expect(mockWelcome).toHaveBeenCalled();
});

it('filters the task catalog and expands matching groups without starting a guide',async()=>{
  await render(<GuidesContext.Provider value={context()}><Guides/></GuidesContext.Provider>);
  expect(screen.queryByText('Find an activity statement')).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText('Search a task or feature'),'statement');
  expect(screen.getByText('Find an activity statement')).toBeTruthy();expect(mockStart).not.toHaveBeenCalled();
});
