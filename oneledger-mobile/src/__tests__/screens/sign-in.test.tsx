import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import SignIn from "@/app/sign-in";

const mockSignIn = jest.fn();
const mockRelease = jest.fn();
const mockOpenUrl = jest.fn();
const mockConfig = { apiBaseUrl: "https://app.example.test", configured: true };

jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({ signIn: (e: string, p: string) => mockSignIn(e, p) }),
}));
jest.mock("@/features/lock/LockProvider", () => ({
  useLock: () => ({ releaseAfterSignIn: () => mockRelease() }),
}));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));
jest.mock("@/lib/config", () => ({
  config: {
    get apiBaseUrl() {
      return mockConfig.apiBaseUrl;
    },
  },
  get isConfigured() {
    return mockConfig.configured;
  },
}));

beforeEach(() => {
  [mockSignIn, mockRelease, mockOpenUrl].forEach((m) => m.mockReset());
  mockConfig.apiBaseUrl = "https://app.example.test";
  mockConfig.configured = true;
});

async function fill(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText("Email"), email);
  await fireEvent.changeText(screen.getByLabelText("Password"), password);
}

describe("Sign-in screen", () => {
  it("signs in with a trimmed email and lifts the lock", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    await render(<SignIn />);
    await fill("  me@example.com ", "hunter2");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith("me@example.com", "hunter2"));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledTimes(1));
  });

  it("asks for both fields and never calls the server when one is missing", async () => {
    await render(<SignIn />);
    await fill("me@example.com", "");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your email and password.")).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("shows the server's reason and does not release the lock when sign-in fails", async () => {
    mockSignIn.mockResolvedValue({ ok: false, message: "Invalid email or password." });
    await render(<SignIn />);
    await fill("me@example.com", "wrong");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password.")).toBeTruthy();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("signs in from the keyboard's Go key", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    await render(<SignIn />);
    await fill("me@example.com", "hunter2");
    await fireEvent(screen.getByLabelText("Password"), "submitEditing");
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });

  it("ignores a second press while signing in", async () => {
    let finish!: (v: { ok: true }) => void;
    mockSignIn.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await render(<SignIn />);
    await fill("me@example.com", "hunter2");
    const button = screen.getByRole("button", { name: "Sign in" });
    // Not awaited: the first press's handler stays pending until we finish it.
    void fireEvent.press(button);
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    void fireEvent.press(button);
    void fireEvent(screen.getByLabelText("Password"), "submitEditing");
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(mockRelease).toHaveBeenCalledTimes(1));
  });

  it("masks the password while typing", async () => {
    await render(<SignIn />);
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
  });

  it("warns when the build is not connected to a backend", async () => {
    mockConfig.configured = false;
    await render(<SignIn />);
    expect(screen.getByText(/isn't connected to OneLedger yet/)).toBeTruthy();
  });

  it("links to creating an account on the web", async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByText("New here? Create your account on the web"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/signup");
  });

  it("offers no sign-up link when there is no API base", async () => {
    mockConfig.apiBaseUrl = "";
    await render(<SignIn />);
    expect(screen.queryByText(/Create your account/)).toBeNull();
  });
});
