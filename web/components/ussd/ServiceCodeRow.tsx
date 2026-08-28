import Link from "next/link";
import { FavouriteButton } from "./FavouriteButton";
import { CATEGORY_LABELS, type ServiceCodeListItem } from "../../lib/ussd/queries";

export function ServiceCodeRow({
  code,
  favourited,
  showFavourite = true,
}: {
  code: ServiceCodeListItem;
  favourited: boolean;
  showFavourite?: boolean;
}) {
  const unverified = code.verified_at == null;
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-stretch gap-2">
        <Link
          href={`/pay/ussd/${code.slug}`}
          className="group flex min-w-0 flex-1 flex-col gap-1.5 py-3 pr-2"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary group-hover:text-accent">
              {code.display_name_en}
            </span>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                unverified
                  ? "bg-attention-bg text-attention"
                  : "bg-money-positive-bg text-money-positive"
              }`}
            >
              {unverified ? "Unverified" : "Verified"}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-text-muted">
            <code className="font-mono text-[13px] text-text-secondary">
              {code.ussd_template}
            </code>
            <span aria-hidden="true">·</span>
            <span>{code.provider.display_name}</span>
            <span aria-hidden="true">·</span>
            <span>{CATEGORY_LABELS[code.category]}</span>
          </div>
        </Link>
        {showFavourite && (
          <div className="flex items-center">
            <FavouriteButton
              serviceCodeId={code.id}
              initialFavourited={favourited}
              label={code.display_name_en}
            />
          </div>
        )}
      </div>
    </li>
  );
}
