export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRegistrationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateRegistration(
  rawEmail: string,
  password: string,
): { email: string; error: string | null } {
  const email = normalizeRegistrationEmail(rawEmail);

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { email, error: "Enter a valid email address." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      email,
      error:
        `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      email,
      error:
        `Use no more than ${MAX_PASSWORD_LENGTH} characters for your password.`,
    };
  }

  return { email, error: null };
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
