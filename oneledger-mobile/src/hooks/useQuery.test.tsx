import { render, screen, waitFor, act } from "@testing-library/react-native";
import { Text } from "react-native";
import { useQuery } from "./useQuery";
let mockScope = "personal";
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: mockScope }) }));
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
function Probe({ load }: { load(): Promise<string> }) { const q = useQuery(load); return <Text>{q.data ?? (q.error ? "unavailable" : "loading")}</Text>; }
it("drops a reversed response from the previous Space", async () => {
  mockScope = "personal";
  let finish!: (value: string) => void;
  const old = new Promise<string>((resolve) => { finish = resolve; });
  const load = () => mockScope === "personal" ? old : Promise.resolve("Household data");
  const view = await render(<Probe load={load} />);
  mockScope = "household";
  await view.rerender(<Probe load={load} />);
  await screen.findByText("Household data");
  await act(async () => finish("Private personal data"));
  expect(screen.queryByText("Private personal data")).toBeNull();
});
it("never leaves the old Space's data under a failed new-Space load", async () => {
  mockScope = "personal";
  const load = () => mockScope === "personal" ? Promise.resolve("Personal data") : Promise.reject(new Error("offline"));
  const view = await render(<Probe load={load} />);
  await screen.findByText("Personal data");
  mockScope = "household";
  await view.rerender(<Probe load={load} />);
  await waitFor(() => expect(screen.getByText("unavailable")).toBeTruthy());
  expect(screen.queryByText("Personal data")).toBeNull();
});
