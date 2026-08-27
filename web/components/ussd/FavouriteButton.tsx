"use client";

import { useState, useTransition } from "react";
import { toggleFavourite } from "../../app/pay/actions";
import { StarIcon } from "../icons";

export function FavouriteButton({
  serviceCodeId,
  initialFavourited,
  label,
}: {
  serviceCodeId: string;
  initialFavourited: boolean;
  label: string;
}) {
  const [favourited, setFavourited] = useState(initialFavourited);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    const optimistic = !favourited;
    setFavourited(optimistic);
    startTransition(async () => {
      const res = await toggleFavourite(serviceCodeId);
      if (!res.ok) {
        setFavourited(!optimistic);
        setError(res.error);
      } else {
        setFavourited(res.favourited);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={favourited}
      aria-label={
        favourited ? `Remove ${label} from favourites` : `Add ${label} to favourites`
      }
      title={error ?? undefined}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
        favourited
          ? "text-accent hover:bg-background"
          : "text-text-muted hover:bg-background hover:text-text-secondary"
      }`}
    >
      <StarIcon filled={favourited} className="h-5 w-5" />
    </button>
  );
}
