// Purely decorative wash behind every pre-auth screen (login, signup,
// verify-email, auth/confirm) - two soft brand-colored blurs, fixed to the
// viewport so they never add to document scroll dimensions and `clip`ped
// by the wrapping overflow-hidden box so blur bleed can't do it either.
// aria-hidden + pointer-events-none: it carries no content and must never
// intercept a click meant for the card in front of it.
export function AuthBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div className="absolute left-1/2 top-[-14rem] h-[26rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-blue/10 blur-3xl" />
      <div className="absolute bottom-[-16rem] right-[-10rem] h-[26rem] w-[26rem] rounded-full bg-brand-navy/[0.06] blur-3xl" />
    </div>
  );
}
