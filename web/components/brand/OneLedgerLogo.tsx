import Image from "next/image";
import primaryLogo from "../../public/brand/oneledger/logo/oneledger-logo-primary.png";
import monochromeLogo from "../../public/brand/oneledger/logo/oneledger-logo-monochrome-dark.png";
import mark from "../../public/brand/oneledger/mark/oneledger-mark.png";

const VARIANTS = {
  primary: primaryLogo,
  monochrome: monochromeLogo,
  mark: mark,
} as const;

type Variant = keyof typeof VARIANTS;

export function OneLedgerLogo({
  variant = "primary",
  height = 24,
  className,
  decorative = false,
}: {
  variant?: Variant;
  /** Rendered height in pixels; width is derived from the source aspect ratio. */
  height?: number;
  className?: string;
  /** Set when adjacent visible text already reads "OneLedger" so a screen reader wouldn't need to hear it twice. */
  decorative?: boolean;
}) {
  const src = VARIANTS[variant];
  return (
    <Image
      src={src}
      alt={decorative ? "" : "OneLedger"}
      aria-hidden={decorative || undefined}
      height={height}
      width={Math.round((height * src.width) / src.height)}
      className={className}
      priority
    />
  );
}
