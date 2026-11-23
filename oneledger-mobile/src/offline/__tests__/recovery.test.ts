import { openUserDatabase } from "../expo-db";
const mockOpen = jest.fn();
const mockDelete = jest.fn();
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: (...args: unknown[]) => mockOpen(...args), deleteDatabaseAsync: (...args: unknown[]) => mockDelete(...args) }));
jest.mock("expo-crypto", () => ({ digestStringAsync: async () => "a".repeat(64), CryptoDigestAlgorithm: { SHA256: "sha256" } }));
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: async () => "a".repeat(64) } }));
it.each(["disk full", "database locked", "not a database", "I/O failure"])("preserves the encrypted file after %s", async (reason) => {
  mockDelete.mockClear(); mockOpen.mockRejectedValue(new Error(reason));
  await expect(openUserDatabase("user-a")).rejects.toThrow("kept on this phone");
  expect(mockDelete).not.toHaveBeenCalled();
});
