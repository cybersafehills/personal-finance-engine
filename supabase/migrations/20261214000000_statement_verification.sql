-- Financial Documents Engine - document verification (master prompt
-- sections 20 / 21). Each generated statement carries an opaque,
-- unguessable verification token; a public page at /verify/<token>
-- confirms the document's identity and integrity WITHOUT exposing any
-- transaction data, balance, account identifier or holder name.
--
-- Additive columns on `statements` (no new table, no new grant). The
-- token is minted by lib/statement-snapshot.ts at generation time.
-- Enumeration protection is the token's own entropy (32 Crockford-base32
-- chars); the public route additionally rate-limits by IP. Revocation is
-- a timestamp - a revoked token's page reports "revoked", never the
-- document details.

alter table public.statements
  add column verification_token text,
  add column verification_revoked_at timestamptz;

comment on column public.statements.verification_token is
  'Opaque unguessable token for the public /verify/<token> page. NULL only on rows predating this migration. Never a sequential or derivable value.';
comment on column public.statements.verification_revoked_at is
  'When set, /verify/<token> reports the verification as revoked and shows no document details.';

create unique index statements_verification_token_key
  on public.statements (verification_token)
  where verification_token is not null;
