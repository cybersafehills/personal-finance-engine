import { supabase } from "@/api/supabase";
import { EMPTY_FEED, parsePartnerFeed, type PartnerFeed } from "./model";

/** The owner-approved offers and placement settings. Sends nothing about the user; any failure means "no sponsored content". */
export async function fetchPartnerFeed(): Promise<PartnerFeed> {
  if (!supabase) return EMPTY_FEED;
  try {
    const { data, error } = await supabase.rpc("partner_feed");
    if (error) return EMPTY_FEED;
    return parsePartnerFeed(data);
  } catch {
    return EMPTY_FEED;
  }
}
