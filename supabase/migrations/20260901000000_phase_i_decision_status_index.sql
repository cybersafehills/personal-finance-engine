-- ===========================================================================
-- Phase I: index category_decision_status - a QA-pass finding.
--
-- category_decision_status has been filtered directly by
-- getReviewQueueTransactions() (increment 3), and by
-- preview_policy_historical_match_count()/preview_policy_historical_matches()/
-- apply_policy_to_historical() (increment 3's historical backfill, always
-- combined with the non-indexable policy_matches_transaction() predicate -
-- narrowing the candidate set with an index first matters more there, not
-- less) since it was introduced, with no supporting index. This was
-- missed at the time; closing it now rather than leaving it for a
-- production data volume to surface as a real slow-query problem.
-- ===========================================================================

create index idx_transactions_decision_status
  on public.transactions (category_decision_status);
