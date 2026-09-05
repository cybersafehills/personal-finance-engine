export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

// Kept in lockstep with supabase/config.toml `password_requirements =
// "letters_digits"`. Enforcing it here as well means a rejected password
// gets a clear, specific message from our own form instead of a generic
// provider error after a round-trip - and the two floors can never drift
// (audit F3). Shown verbatim under every password field.
export const PASSWORD_REQUIREMENT_HINT =
  `At least ${MIN_PASSWORD_LENGTH} characters, including a letter and a number.`;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRegistrationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The password floor shared by signup and the reset-password confirm step.
 * Returns a user-facing message, or null when the password is acceptable.
 * Mirrors Supabase Auth's own `minimum_password_length` +
 * `password_requirements` so the client, our server actions, and the
 * provider all agree.
 */
export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use no more than ${MAX_PASSWORD_LENGTH} characters for your password.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number in your password.";
  }
  return null;
}

export function validateRegistration(
  rawEmail: string,
  password: string,
): { email: string; error: string | null } {
  const email = normalizeRegistrationEmail(rawEmail);

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { email, error: "Enter a valid email address." };
  }

  return { email, error: passwordError(password) };
}

export function registrationErrorMessage(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("rate") || normalized.includes("too many")) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (normalized.includes("password")) {
    return `Use a stronger password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (normalized.includes("email")) {
    return "Check your email address and try again.";
  }

  return "We couldn't create your account right now. Please try again.";
}
