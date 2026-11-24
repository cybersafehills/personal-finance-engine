import { act, renderHook } from "@testing-library/react-native";
import { useQuery } from "../useQuery";
import { setOfflineRuntime } from "@/offline/runtime";
const mockSpace = { activeId: "one" };
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => mockSpace }));
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { mockSpace.activeId = "one"; });
it("publishes the first result during a refresh burst and coalesces trailing reads", async () => {
  const first = deferred<string>(), next = deferred<string>();
  const load = jest.fn().mockReturnValueOnce(first.promise).mockReturnValue(next.promise);
  const { result } = await renderHook(() => useQuery(load));
  await act(() => { for (let i = 0; i < 10; i++) setOfflineRuntime(null); });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve("first result"); await first.promise; });
  expect(result.current.data).toBe("first result");
  expect(result.current.loading).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => { next.resolve("updated result"); await next.promise; });
  expect(result.current.data).toBe("updated result");
});
it("does not reuse or publish a request from another Space", async () => {
  const one = deferred<string>(), two = deferred<string>();
  const load = jest.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  const { result, rerender } = await renderHook(() => useQuery(load));
  mockSpace.activeId = "two";
  await rerender({});
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => { one.resolve("private one"); await one.promise; });
  expect(result.current.data).toBeNull();
  await act(async () => { two.resolve("private two"); await two.promise; });
  expect(result.current.data).toBe("private two");
});
