# Offline synchronization and authorization

## Approved policy

The user explicitly approved **a seven-day authorization lease for shared financial records** during this implementation session. `SHARED_LEASE_MS` is seven days. Personal offline access continues after successful bootstrap without the shared lease expiry. Household and organization reads require a valid lease; absent/invalid/expired leases fail closed. Pending work is retained.

A complete, successful, authorization-respecting snapshot renews the lease using the first server timestamp, never the device's completion timestamp. Partial/capped/failed downloads do not renew it. The provider schedules expiry notifications so mounted financial queries clear and recheck. Backward device-clock movement before the check timestamp is refused. Local clock integrity and OS tampering are not cryptographically guaranteed; test clock changes on devices before release.

This bounds application access, not physical deletion on an indefinitely disconnected or compromised device. Server revocation cannot immediately erase disconnected storage. Encrypted bytes can remain inaccessible after lease expiry; reconnect reconciliation removes synchronized records that are no longer visible. Old installed binaries do not implement this protocol and cannot be treated as compliant: rollout requires an explicit client-version retirement/enforcement strategy.

## Reconciliation

New clients use `sync_financial_snapshot_page` (keyset UUID ordering, JSON rows envelope, maximum 500 rows) followed by batched `sync_visible_transaction_ids` under fresh caller RLS. The full visible set repairs deletion, late commit, moved records, lost membership and revoked source shares. Mid-download revocations are revalidated before renewal. A maximum-page guard fails closed. Separate requests do not form a repeatable-read database snapshot; concurrent writes may converge on the next reconciliation. Do not describe totals as an atomic temporal snapshot across requests.

Synced absent records are evicted. Unsynced known-server records absent from the authorized set are quarantined with `visibility_revoked`; they cannot be read through list/detail/aggregate/conflict projections. New personal pending work and stable operation IDs are preserved. Local schema v3 adds leases, visibility/classification columns, snapshot membership and encrypted wallet evidence with a workspace/date index.

## Identity and lifecycle

Single-flight workers are keyed by database handle. Every network boundary checks the originating user; transport uses a stateless client with the originating bearer, rather than uploading an old queue through a mutable new-user singleton. Cancellation guards surround awaits. Cleanup clears runtime, waits for its worker, then closes that database. Root financial providers/navigation remount per user. Queries carry Space/query keys and discard old responses; selected Space is separate from legacy null-means-Personal headers. Wallet cache writes also reject changed user/database handles.

Existing manual-create and category-edit outbox operations, operation IDs, conflict history, retry/backoff and server idempotency remain. An in-flight operation may have reached the server before cancellation; idempotent replay reconciles its acknowledgment next time. Pending category edits do not create new money.

## Recovery and privacy

SQLCipher remains mandatory; builds without encryption use online-only behavior. Database open/read/migration errors no longer trigger automatic deletion/recreation. Handles are closed on failure and local data is preserved with actionable recovery copy. Disk-full, locked database, corrupt/key mismatch and I/O test cases assert no deletion. Detailed platform diagnosis and a user-driven destructive recovery/export workflow remain incomplete; the patch does not claim to distinguish every native error reliably.

Privacy preferences are stored per user in SecureStore. Amounts mask until preferences load; full privacy overrides explicit unmasked amount props. Reusable Text/Button/Pressable paths redact supported formatted monetary labels. Existing app-state lock cover is preserved. This is not an audited guarantee for every editable field, screenshot, OS preview, or accessibility tree; real-device screen-reader/background testing is mandatory.

## Verified versus pending

Jest covers seven-day boundary expiry, revoke/delete eviction, pending retention/quarantine, incomplete downloads, mid-download revocation, old-user cancellation, frozen bearer identity, recovery and reversed Space responses. Physical cold airplane-mode launch, process kill/restart, SecureStore loss, SQLCipher migration interruption, app-switcher snapshots and reconnect journeys remain unverified. No physical deletion or remote-device erasure claim is made.
