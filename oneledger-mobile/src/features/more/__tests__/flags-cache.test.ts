import { act, renderHook } from "@testing-library/react-native";

import { rememberMoreFlags, resetMoreFlagsCache, useMoreFlags } from "../flags-cache";

let mockFlags: unknown = null;
jest.mock("@/api/mobile-api", () => ({ fetchMoreFlags: () => new Promise(() => {}) }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: "w1" }) }));
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: async () => null, set: async () => {} } }));
jest.mock("@/hooks/useQuery", () => ({ useQuery: () => ({ data: mockFlags }) }));

beforeEach(() => { resetMoreFlagsCache(); mockFlags = null; });

it("draws with the remembered flags before the fresh answer arrives", async () => {
  rememberMoreFlags("w1", { bills: true });
  const { result } = await renderHook(() => useMoreFlags());
  expect(result.current).toEqual({ bills: true });
});

it("is empty for a Space nothing is known about, and prefers a fresh answer", async () => {
  const { result, rerender } = await renderHook(() => useMoreFlags());
  expect(result.current).toBeNull();
  mockFlags = { bills: false };
  await act(async () => { rerender({}); });
  expect(result.current).toEqual({ bills: false });
});
