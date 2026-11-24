import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "@/components/ds";
import Preview from "@/app/(app)/partner-preview";
import Offers from "@/app/(app)/partner-offers";
import Detail from "@/app/(app)/partner-offer/[id]";
import Preferences from "@/app/(app)/partner-preferences";
import { PartnerPreviewProvider, usePartnerPreview } from "../PartnerPreviewProvider";
import { PartnerHomePlacement, PartnerPlacement } from "../PartnerOfferCard";
import { router, resetRouterMock, setParams } from "@/test/router-mock";
import { initialPlacements } from "../model";
const mockUser = { id: "account-one" };
jest.mock("../feed", () => ({ fetchPartnerFeed: jest.fn(async () => ({ enabled: false, placements: {}, offers: [] })) }));
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/auth/SessionProvider", () => ({ useSession: () => ({ session: { user: mockUser } }) }));
function Toggle() { const context = usePartnerPreview(); return <Button label="Enable preview" onPress={context.start}/>; }
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date("2026-11-23T12:00:00Z")); mockUser.id = "account-one"; resetRouterMock(); });
afterEach(() => jest.useRealTimers());
it("opens actual Home only after explicit opt-in", async () => {
  await render(<PartnerPreviewProvider><Preview/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Preview on my Home screen"}));
  expect(router.navigate).toHaveBeenCalledWith("/");
});
it("keeps Home placement hidden while core content is loading, and dismisses it", async () => {
  const tree = await render(<PartnerPreviewProvider><Toggle/><PartnerHomePlacement ready={false}/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  expect(screen.queryByTestId("partner-home-placement")).toBeNull();
  await tree.rerender(<PartnerPreviewProvider><Toggle/><PartnerHomePlacement ready/></PartnerPreviewProvider>);
  expect(screen.getByTestId("partner-home-placement")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", {name:"Dismiss Home promotion for seven days"}));
  expect(screen.queryByTestId("partner-home-placement")).toBeNull();
});
it("does not carry enabled preview state into another account", async () => {
  const tree = await render(<PartnerPreviewProvider><Toggle/><PartnerHomePlacement ready/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  expect(screen.getByTestId("partner-home-placement")).toBeTruthy();
  mockUser.id = "account-two";
  await tree.rerender(<PartnerPreviewProvider><Toggle/><PartnerHomePlacement ready/></PartnerPreviewProvider>);
  expect(screen.queryByTestId("partner-home-placement")).toBeNull();
});
it("filters the offers hub by category and search", async () => {
  await render(<PartnerPreviewProvider><Toggle/><Offers/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  expect(screen.getAllByRole("button", {name:"View offer"})).toHaveLength(3);
  await fireEvent.press(screen.getByRole("button", {name:"Learning"}));
  expect(screen.getAllByRole("button", {name:"View offer"})).toHaveLength(1);
  await fireEvent.changeText(screen.getByLabelText("Search offers"), "does-not-exist");
  expect(screen.getByText("No offers match")).toBeTruthy();
});
it("shows terms and a destination preview without any external navigation", async () => {
  setParams({ id: "example-bank" });
  await render(<PartnerPreviewProvider><Toggle/><Detail/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  expect(screen.getByText("Financial promotion disclosure")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", {name:"Preview provider destination"}));
  expect(screen.getByText("Provider destination")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", {name:"Close preview"}));
  await fireEvent.press(screen.getByRole("button", {name:"Hide this brand"}));
  expect(router.replace).toHaveBeenCalledWith("/partner-offers");
});
it("changes language to a no-fill state in preferences", async () => {
  await render(<PartnerPreviewProvider><Toggle/><Preferences/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  await fireEvent.press(screen.getByRole("button", {name:"Kinyarwanda"}));
  expect(screen.getByRole("button", {name:"Kinyarwanda, selected"})).toBeTruthy();
});

it("cannot enable fictional placements in a release build", async () => {
  const environment = globalThis as typeof globalThis & { __DEV__: boolean };
  const previous = environment.__DEV__;
  environment.__DEV__ = false;
  try {
    await render(<PartnerPreviewProvider><Toggle/><PartnerHomePlacement ready/></PartnerPreviewProvider>);
    await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
    expect(screen.queryByTestId("partner-home-placement")).toBeNull();
  } finally { environment.__DEV__ = previous; }
});

it("rotates a carousel, pauses while the form is in use, and shows tiles on Pay and a bar on Plan", async () => {
  const tree = await render(<PartnerPreviewProvider><Toggle/><PartnerPlacement id="home"/></PartnerPreviewProvider>);
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  expect(screen.getByText("A little more connection, for less")).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(5000 + 500); });
  expect(screen.getByText("Understand your account options")).toBeTruthy();
  await tree.rerender(<PartnerPreviewProvider><Toggle/><PartnerPlacement id="pay-person" paused/></PartnerPreviewProvider>);
  expect(screen.getAllByTestId("partner-square")).toHaveLength(2);
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(screen.getAllByTestId("partner-square")).toHaveLength(2);
  await tree.rerender(<PartnerPreviewProvider><Toggle/><PartnerPlacement id="plan"/></PartnerPreviewProvider>);
  expect(screen.getByTestId("partner-bar")).toBeTruthy();
});

it("explains itself instead of staying silent when the preview is on but Home is not ready", async () => {
  await render(<PartnerPreviewProvider><Toggle/><PartnerHomePlacement ready={false} blockedBy="There are no recent transactions yet"/></PartnerPreviewProvider>);
  expect(screen.queryByTestId("partner-home-waiting")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name:"Enable preview"}));
  expect(screen.getByText(/no recent transactions yet/)).toBeTruthy();
  expect(screen.queryByTestId("partner-banner")).toBeNull();
});

it("shows owner-approved offers to a normal user with no preview, and nothing when the feed is off", async () => {
  const feed = jest.requireMock("../feed") as { fetchPartnerFeed: jest.Mock };
  feed.fetchPartnerFeed.mockResolvedValue({
    enabled: true, placements: initialPlacements(),
    offers: [{ id: "real-1", brandId: "b1", brand: "Acme", category: "Learning", title: "Build a skill", benefit: "Intro course", eligibility: "Adults", terms: "Terms apply to this offer", destination: "https://example.com/x", endsOn: "2099-12-31", country: "Rwanda", language: "English", homeFeatured: true }],
  });
  await render(<PartnerPreviewProvider><PartnerHomePlacement ready/></PartnerPreviewProvider>);
  expect(await screen.findByText("Build a skill")).toBeTruthy();
  expect(screen.getByText(/^Sponsored · Acme$/)).toBeTruthy();
  expect(screen.queryByText(/fictional/)).toBeNull();
});
it("renders nothing for a normal user while the platform has delivery off", async () => {
  const feed = jest.requireMock("../feed") as { fetchPartnerFeed: jest.Mock };
  feed.fetchPartnerFeed.mockResolvedValue({ enabled: false, placements: initialPlacements(), offers: [] });
  await render(<PartnerPreviewProvider><PartnerHomePlacement ready/></PartnerPreviewProvider>);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("partner-home-placement")).toBeNull();
});
