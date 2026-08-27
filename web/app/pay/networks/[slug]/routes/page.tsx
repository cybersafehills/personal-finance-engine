import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The route finder + results now live on the network page itself
// (/pay/networks/[slug]). This path is kept so old links / bookmarks and
// the "back" link from a route result still resolve; it forwards to the
// merged page, preserving any finder filters in the query string.
export default async function LegacyRouteFinderRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const key of ["from", "flow", "channel"]) {
    const v = sp[key];
    if (typeof v === "string" && v) qs.set(key, v);
  }
  const query = qs.toString();
  redirect(`/pay/networks/${slug}${query ? `?${query}` : ""}`);
}
