/** Minimum password length enforced by WMS API. */
export const MIN_PASSWORD_LENGTH = 6;

export function validatePasswordPair(
  newPassword: string,
  confirmPassword: string
): string | null {
  const next = newPassword.trim();
  const confirm = confirmPassword.trim();

  if (!next || !confirm) {
    return "Please enter and confirm your new password.";
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }
  if (next !== confirm) {
    return "New password and confirmation do not match.";
  }
  return null;
}

export function parseAuthErrorPayload(
  errorData: any,
  fallbackMessage: string
): { message: string; code?: string } {
  const code = errorData?.error?.code || errorData?.code;
  const message =
    errorData?.error?.message ||
    errorData?.message ||
    (typeof errorData?.error === "string" ? errorData.error : null) ||
    fallbackMessage;
  return { message, code };
}

export function cleanAuthErrorMessage(message: string): string {
  return String(message || "")
    .replace(/\s*- DEBUG:.*$/i, "")
    .trim();
}

export function throwAuthError(message: string, code?: string): never {
  const err = new Error(cleanAuthErrorMessage(message)) as Error & { code?: string };
  if (code) err.code = code;
  throw err;
}
