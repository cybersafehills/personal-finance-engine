import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import CreateSpace from "@/app/(app)/create-space";
import { resetRouterMock, router } from "@/test/router-mock";

const mockSpacesEnabled = jest.fn();
const mockCreate = jest.fn();
const mockActivate = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchSpacesEnabled: () => mockSpacesEnabled() }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({
  useActiveSpace: () => ({
    spaces: [],
    active: null,
    activeId: null,
    setActive: () => {},
    activateCreated: (id: string) => mockActivate(id),
  }),
}));
jest.mock("@/features/spaces/create", () => {
  const actual = jest.requireActual("@/features/spaces/create");
  return { ...actual, createSpace: (kind: string, name: string) => mockCreate(kind, name) };
});

beforeEach(() => {
  resetRouterMock();
  [mockSpacesEnabled, mockCreate, mockActivate].forEach((m) => m.mockReset());
  mockSpacesEnabled.mockResolvedValue(true);
  mockActivate.mockResolvedValue(undefined);
});

describe("Create a Space", () => {
  it("offers households and organizations when Spaces is on", async () => {
    await render(<CreateSpace />);
    expect(await screen.findByLabelText("Household")).toBeTruthy();
    expect(screen.getByLabelText("Organization")).toBeTruthy();
    expect(screen.getByText("Household name")).toBeTruthy();
  });

  it("offers only an organization when Spaces is off", async () => {
    mockSpacesEnabled.mockResolvedValue(false);
    await render(<CreateSpace />);
    expect(await screen.findByText("Organization name")).toBeTruthy();
    expect(screen.queryByLabelText("Household")).toBeNull();
  });

  it("creates the Space, switches to it and goes Home", async () => {
    mockCreate.mockResolvedValue("space-1");
    await render(<CreateSpace />);
    await screen.findByLabelText("Household");

    await fireEvent.changeText(screen.getByLabelText("Household name"), "  Dolton  Household ");
    await fireEvent.press(screen.getByText("Create household"));

    await waitFor(() => expect(mockActivate).toHaveBeenCalledWith("space-1"));
    expect(mockCreate).toHaveBeenCalledWith("household", "Dolton Household");
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("creates an organization when that kind is picked", async () => {
    mockCreate.mockResolvedValue("space-2");
    await render(<CreateSpace />);
    await fireEvent.press(await screen.findByLabelText("Organization"));
    await fireEvent.changeText(screen.getByLabelText("Organization name"), "Dolton & Co");
    await fireEvent.press(screen.getByText("Create organization"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("organization", "Dolton & Co"));
  });

  it("asks for a name instead of calling the server", async () => {
    await render(<CreateSpace />);
    await fireEvent.press(await screen.findByText("Create household"));
    expect(await screen.findByText("Enter a name.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows the failure and stays on the form", async () => {
    const { CreateSpaceError } = jest.requireActual("@/features/spaces/create");
    mockCreate.mockRejectedValue(new CreateSpaceError("Couldn't create that Space. Check your connection and try again."));
    await render(<CreateSpace />);
    await fireEvent.changeText(await screen.findByLabelText("Household name"), "Home");
    await fireEvent.press(screen.getByText("Create household"));
    expect(await screen.findByText(/Couldn't create that Space/)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockActivate).not.toHaveBeenCalled();
  });
});
