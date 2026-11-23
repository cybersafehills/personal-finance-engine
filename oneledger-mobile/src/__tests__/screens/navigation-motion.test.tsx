import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Dimensions,ScrollView,StyleSheet } from "react-native";
import { NavigationChromeProvider } from "@/components/shell/NavigationChrome";
import { useNavigationChrome } from "@/components/shell/NavigationChromeContext";
import { isHomePath,isTabPath,scrollChromeMode,useChromeScroll } from "@/components/shell/useChromeScroll";
import { MotionTabBar } from "@/components/shell/MotionTabBar";
import { router } from "@/test/router-mock";
import { Text } from "@/components/ds";
let mockPath="/";
const mockConfig=jest.fn();
jest.mock("expo-router",()=>({...jest.requireActual("@/test/router-mock"),usePathname:()=>mockPath}));
jest.mock("react-native-reanimated",()=>jest.requireActual("react-native-reanimated/mock"));
jest.mock("react-native-safe-area-context",()=>({...jest.requireActual("react-native-safe-area-context/jest/mock").default}));
jest.mock("@/api/mobile-api",()=>({fetchPayConfig:()=>mockConfig()}));
jest.mock("@/features/spaces/ActiveSpaceProvider",()=>({useActiveSpace:()=>({activeId:"w1"})}));
jest.mock("@/lib/device-store",()=>({deviceStore:{get:async()=>null,set:async()=>{}}}));
const all={ok:true,pay:true,assistedPay:true,ussdDirectory:true,scanToPay:true,trustedRecipients:true,paymentRequests:true};
function Probe(){const chrome=useNavigationChrome();const onScroll=useChromeScroll();return <ScrollView testID="scroll" onScroll={onScroll}><Text>{`${chrome.home}:${chrome.onTabs}:${chrome.compact}`}</Text></ScrollView>;}
beforeEach(()=>{mockPath="/";mockConfig.mockResolvedValue(all);router.push.mockClear();});
it("compacts on downward travel, restores on upward travel and resets on pushed routes",async()=>{
 const tree=await render(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 await screen.findByRole("button",{name:"Pay"});
 await fireEvent(screen.getByTestId("scroll"),"scroll",{nativeEvent:{contentOffset:{y:100}}});
 expect(screen.getByText("true:true:true")).toBeTruthy();
 await fireEvent(screen.getByTestId("scroll"),"scroll",{nativeEvent:{contentOffset:{y:80}}});
 expect(screen.getByText("true:true:false")).toBeTruthy();
 mockPath="/settings";await tree.rerender(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 expect(screen.getByText("false:false:false")).toBeTruthy();
 await fireEvent.press(screen.getByRole("button",{name:"Pay"}));expect(router.push).toHaveBeenLastCalledWith("/pay-sheet");
 await fireEvent(screen.getByRole("button",{name:"Pay"}),"longPress");expect(router.push).toHaveBeenLastCalledWith({pathname:"/scan"});
 mockPath="/";await tree.rerender(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 expect(screen.getByText("true:true:false")).toBeTruthy();
});
it("keeps Pay centred on every tab and docks it at the right without a caption on detail pages",async()=>{
 const tree=await render(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 await screen.findByRole("button",{name:"Pay"});
 const left=()=>StyleSheet.flatten(screen.getByTestId("global-pay-position").props.style).left;
 const width=Dimensions.get("window").width;
 expect(left()).toBe((width-48)/2);
 for(const path of ["/transactions","/plan","/more"]){
  mockPath=path;await tree.rerender(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
  expect(left()).toBe((width-48)/2);expect(screen.getByText("Pay",{includeHiddenElements:true})).toBeTruthy();
 }
 for(const path of ["/settings","/wallet/a"]){
  mockPath=path;await tree.rerender(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
  expect(left()).toBe(width-16-48);expect(screen.queryByText("Pay",{includeHiddenElements:true})).toBeNull();
  expect(screen.getByRole("button",{name:"Pay"})).toBeTruthy();
 }
 mockPath="/more";await tree.rerender(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 expect(left()).toBe((width-48)/2);expect(screen.getByText("Pay",{includeHiddenElements:true})).toBeTruthy();
});
it("respects payment gates and hides the redundant launcher inside a payment sheet",async()=>{
 mockConfig.mockResolvedValue({...all,pay:false});
 const tree=await render(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 await waitFor(()=>expect(mockConfig).toHaveBeenCalled());expect(screen.queryByRole("button",{name:"Pay"})).toBeNull();
 mockPath="/pay-sheet";await tree.rerender(<NavigationChromeProvider><Probe/></NavigationChromeProvider>);
 expect(screen.queryByRole("button",{name:"Pay"})).toBeNull();
});
it("emits preventable tab events and navigates with the SDK tab key",async()=>{
 const emit=jest.fn(()=>({defaultPrevented:false})),navigateToTab=jest.fn();
 const props={state:{index:0,routes:["index","transactions","plan","more"].map(name=>({name,key:name+"-key"}))},emitter:{emit},navigateToTab};
 await render(<MotionTabBar {...props as unknown as Parameters<typeof MotionTabBar>[0]}/>);
 await fireEvent.press(screen.getByRole("tab",{name:"Transactions"}));
 expect(navigateToTab).toHaveBeenCalledWith("transactions-key");
 emit.mockReturnValue({defaultPrevented:true});await fireEvent.press(screen.getByRole("tab",{name:"More"}));expect(navigateToTab).toHaveBeenCalledTimes(1);
});
it("uses direction thresholds and identifies only the actual home and tab paths",()=>{
 expect(scrollChromeMode(0,10)).toBe(false);expect(scrollChromeMode(50,60)).toBeNull();expect(scrollChromeMode(50,90)).toBe(true);expect(scrollChromeMode(90,70)).toBe(false);
 expect(isHomePath("/")).toBe(true);expect(isHomePath("/settings")).toBe(false);expect(isTabPath("/more")).toBe(true);expect(isTabPath("/wallet/a")).toBe(false);
});
