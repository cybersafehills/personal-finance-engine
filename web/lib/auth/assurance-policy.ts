export function needsMfaStepUp(
  verifiedFactorCount: number,
  currentLevel: string | null | undefined,
): boolean {
  return verifiedFactorCount > 0 && currentLevel !== "aal2";
}
