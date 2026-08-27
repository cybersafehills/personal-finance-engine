import Link from "next/link";
import { Badge } from "../Badge";
import { FavouriteButton } from "./FavouriteButton";
import { messages } from "../../lib/ussd/messages";
import { CATEGORY_LABELS, type ServiceCodeListItem } from "../../lib/ussd/queries";

const t = messages().ussd;

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
    <li className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <Link href={`/pay/ussd/${code.slug}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-text-primary">{code.display_name_en}</span>
          <span className="font-mono text-xs text-text-muted">{code.ussd_template}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <span>{code.provider.display_name}</span>
          <span aria-hidden="true">·</span>
          <span>{CATEGORY_LABELS[code.category]}</span>
          {unverified ? (
            <Badge variant="attention">{t.notVerifiedBadge}</Badge>
          ) : (
            <Badge variant="positive">{t.verifiedBadge}</Badge>
          )}
        </div>
      </Link>
      {showFavourite && (
        <FavouriteButton
          serviceCodeId={code.id}
          initialFavourited={favourited}
          label={code.display_name_en}
        />
      )}
    </li>
  );
}
