import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import SpaceMembers from "@/app/(app)/space-members";
import type { Member, PendingInvite } from "@/features/spaces/members";
import type { Space } from "@/features/spaces/spaces";
import { resetRouterMock, router } from "@/test/router-mock";

let mockActive: Space | null;
const mockMembers = jest.fn();
const mockNames = jest.fn();
const mockInvites = jest.fn();
const mockSetRole = jest.fn();
const mockRemove = jest.fn();
const mockInvite = jest.fn();
const mockRevoke = jest.fn();
const mockShare = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({ session: { user: { id: "u-me" } } }),
}));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({
  useActiveSpace: () => ({ spaces: [], active: mockActive, activeId: mockActive?.id ?? null, setActive: () => {}, activateCreated: async () => {} }),
}));
jest.mock("@/features/spaces/members-queries", () => ({
  getMembers: (id: string) => mockMembers(id),
  getMemberNames: (id: string) => mockNames(id),
  getPendingInvites: (id: string) => mockInvites(id),
}));
jest.mock("@/api/mobile-api", () => ({
  setMemberRole: (...a: unknown[]) => mockSetRole(...a),
  removeMember: (...a: unknown[]) => mockRemove(...a),
  inviteMember: (...a: unknown[]) => mockInvite(...a),
  revokeInvite: (...a: unknown[]) => mockRevoke(...a),
}));
jest.mock("react-native/Libraries/Share/Share", () => ({
  __esModule: true,
  default: { share: (...a: unknown[]) => mockShare(...a) },
}));

const house: Space = { id: "w1", name: "Dolton Household", kind: "household", role: "owner" };
const me: Member = { membershipId: "m-me", userId: "u-me", role: "owner", status: "active", joinedAt: "2026-09-01T10:00:00Z", isSelf: true };
const sash: Member = { membershipId: "m-sash", userId: "u-sash-0000-4000", role: "member", status: "active", joinedAt: "2026-09-02T10:00:00Z", isSelf: false };
const invite: PendingInvite = { id: "i1", email: "kenia@example.com", role: "viewer", expiresAt: "2026-11-30T10:00:00Z", expired: false };

beforeEach(() => {
  resetRouterMock();
  [mockMembers, mockNames, mockInvites, mockSetRole, mockRemove, mockInvite, mockRevoke, mockShare].forEach((m) => m.mockReset());
  mockActive = house;
  mockMembers.mockResolvedValue([me, sash]);
  mockNames.mockResolvedValue(new Map([["u-sash-0000-4000", "Sash"]]));
  mockInvites.mockResolvedValue([invite]);
  mockSetRole.mockResolvedValue({ ok: true });
  mockRemove.mockResolvedValue({ ok: true });
  mockRevoke.mockResolvedValue({ ok: true });
});

describe("Space & members", () => {
  it("in the Personal Space it points to creating a shared Space", async () => {
    mockActive = { id: "p", name: "Personal", kind: "personal", role: "owner" };
    await render(<SpaceMembers />);
    expect(await screen.findByText("Nobody else is in your Personal Space")).toBeTruthy();
    await fireEvent.press(screen.getByText("Create a Space"));
    expect(router.push).toHaveBeenCalledWith("/create-space");
  });

  it("lists members with names and roles, you first as You", async () => {
    await render(<SpaceMembers />);
    expect(await screen.findByText("You")).toBeTruthy();
    expect(screen.getByText("Sash")).toBeTruthy();
    expect(screen.getByText("Household · members and invites")).toBeTruthy();
    expect(screen.getByText("Pending invites")).toBeTruthy();
    expect(screen.getByText("kenia@example.com")).toBeTruthy();
  });

  it("lets an owner change another member's role, naming this Space explicitly", async () => {
    await render(<SpaceMembers />);
    await screen.findByText("Sash");
    // Sash's row is the only one with role chips (no controls on your own row).
    const admins = screen.getAllByLabelText("Admin");
    await fireEvent.press(admins[0]);
    await waitFor(() => expect(mockSetRole).toHaveBeenCalledWith("w1", "m-sash", "admin"));
  });

  it("asks before making someone an owner", async () => {
    await render(<SpaceMembers />);
    await screen.findByText("Sash");
    await fireEvent.press(screen.getAllByLabelText("Owner")[0]);
    expect(await screen.findByText(/Make Sash an owner\?/)).toBeTruthy();
    expect(mockSetRole).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Make owner"));
    await waitFor(() => expect(mockSetRole).toHaveBeenCalledWith("w1", "m-sash", "owner"));
  });

  it("confirms before removing, then removes", async () => {
    await render(<SpaceMembers />);
    await fireEvent.press(await screen.findByText("Remove"));
    expect(await screen.findByText("Remove Sash from this Space?")).toBeTruthy();
    expect(mockRemove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Yes, remove"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("w1", "m-sash"));
  });

  it("shows the server's sentence when a change is refused", async () => {
    mockRemove.mockResolvedValue({ ok: false, reason: "error", message: "A Space must always have at least one owner." });
    await render(<SpaceMembers />);
    await fireEvent.press(await screen.findByText("Remove"));
    await fireEvent.press(await screen.findByText("Yes, remove"));
    expect(await screen.findByText("A Space must always have at least one owner.")).toBeTruthy();
  });

  it("offers an admin invites but no role or remove controls", async () => {
    mockActive = { ...house, role: "admin" };
    mockMembers.mockResolvedValue([{ ...me, role: "admin" }, sash]);
    await render(<SpaceMembers />);
    await screen.findByText("Sash");
    expect(screen.queryByText("Remove")).toBeNull();
    expect(screen.queryAllByLabelText("Owner")).toHaveLength(0);
    expect(screen.getByText("Invite someone")).toBeTruthy();
  });

  it("offers a plain member nothing to change and no invite form", async () => {
    mockActive = { ...house, role: "member" };
    mockMembers.mockResolvedValue([{ ...me, role: "member" }, { ...sash, role: "owner" }]);
    mockInvites.mockResolvedValue([]);
    await render(<SpaceMembers />);
    await screen.findByText("Sash");
    expect(screen.queryByText("Remove")).toBeNull();
    expect(screen.queryByText("Invite someone")).toBeNull();
  });

  it("invites by email and offers the link once", async () => {
    mockInvite.mockResolvedValue({ ok: true, link: "https://app.example/invite/secret", emailSent: false });
    await render(<SpaceMembers />);
    await fireEvent.changeText(await screen.findByLabelText("Email"), " new@example.com ");
    await fireEvent.press(screen.getByText("Send invite"));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith("w1", "new@example.com", "member"));
    expect(await screen.findByText(/couldn't email new@example.com/i)).toBeTruthy();
    await fireEvent.press(screen.getByText("Share link"));
    expect(mockShare).toHaveBeenCalledWith({ message: "Join Dolton Household on OneLedger: https://app.example/invite/secret" });

    await fireEvent.press(screen.getByText("Done"));
    expect(screen.queryByText("Share link")).toBeNull();
  });

  it("checks the email before calling the server", async () => {
    await render(<SpaceMembers />);
    await fireEvent.changeText(await screen.findByLabelText("Email"), "not an email");
    await fireEvent.press(screen.getByText("Send invite"));
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it("cancels a pending invite after confirming", async () => {
    await render(<SpaceMembers />);
    await fireEvent.press(await screen.findByText("Cancel invite"));
    await fireEvent.press(await screen.findByText("Yes, cancel it"));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("w1", "i1"));
  });
});
