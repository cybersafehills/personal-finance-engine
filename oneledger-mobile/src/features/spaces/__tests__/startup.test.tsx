import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ActiveSpaceProvider, useActiveSpace } from "../ActiveSpaceProvider";
const mockUser = { id: "user-one" };
const mockGetSpaces = jest.fn();
const mockGet = jest.fn();
jest.mock("@/features/auth/SessionProvider", () => ({ useSession: () => ({ session: { user: mockUser } }) }));
jest.mock("../queries", () => ({ getSpaces: () => mockGetSpaces() }));
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: (key: string) => mockGet(key), set: jest.fn().mockResolvedValue(undefined) } }));
function Probe() { const { activeId } = useActiveSpace(); return <Text>{activeId ?? "pending"}</Text>; }
it("restores only the current user's saved scope before network validation, then applies revoked membership", async () => {
  const personal = { id: "personal", name: "Personal", kind: "personal", role: "owner" };
  const household = { id: "household", name: "Family", kind: "household", role: "member" };
  mockGet.mockImplementation(async key => key === "ol.spaces.v1.user-one" ? JSON.stringify([personal, household]) : key === "oneledger.activeSpace.user-one" ? "household" : null);
  let finish!: (value: unknown) => void;
  mockGetSpaces.mockReturnValue(new Promise(r => { finish = r; }));
  await render(<ActiveSpaceProvider><Probe/></ActiveSpaceProvider>);
  expect(await screen.findByText("household")).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith("ol.spaces.v1.user-one");
  await act(async () => { finish([personal]); });
  expect(await screen.findByText("personal")).toBeTruthy();
});
