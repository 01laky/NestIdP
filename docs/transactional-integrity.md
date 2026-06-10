# Transactional-integrity sweep (Prompt 38 §14)

Every multi-write operation that must be atomic, with the mechanism and the test that proves it.
An unticked/non-atomic item requires a written justification here — none remain without one.

| #   | Operation                                                                           | Mechanism                                                                                  | Proof (test)                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `completeSso`: SP-participation create + one-time SAML-session delete               | interactive `$transaction` (`saml-sso.service`)                                            | `API-AUTH-SSO-TXN-01` (single-transaction structure + consistent outcome), `API-AUTH-SSO-TXN-02` (failure ⇒ session not consumed, no participation leak) |
| 2   | `removeConnectionIdentities` — **delete** branch, local store                       | `$transaction` (`identity.repository`)                                                     | `PARITY-REMOVE-DELETE` (both stores, PGlite + libSQL)                                                                                                    |
| 3   | `removeConnectionIdentities` — **deactivate** branch, both stores                   | local `$transaction`; external one Kysely `db.transaction()` (chunked `IN`)                | `PARITY-REMOVE-DEACTIVATE`                                                                                                                               |
| 4   | `purgeExpiredSessions`: pending sessions + expired SSO sessions + stale replay rows | array-form `$transaction` of the three `deleteMany`s; returns the **full** purged count    | cleanup spec asserts the single-transaction call shape; array-form `$transaction` is atomic by Prisma contract                                           |
| 5   | `account-lockout.recordFailure`                                                     | atomic upsert with `increment` (no read-modify-write)                                      | `LOCK-RACE-01/02` (real libSQL, §12 harness — N concurrent failures ⇒ `failedCount === N`)                                                               |
| 6   | last-admin / self delete                                                            | count-after-delete inside `$transaction`                                                   | `API-ADM-USR-RACE-01` (concurrent deletes keep ≥ 1 admin)                                                                                                |
| 7   | SAML session → user bind                                                            | atomic conditional `updateMany` (one winner)                                               | `API-AUTH-SAML-BIND-06` (concurrent binds — exactly one wins)                                                                                            |
| 8   | `ensureSigningMaterial` first-use generation                                        | atomic conditional claim: `updateMany` on the empty slot; losers re-read the winner's pair | `API-SAML-SIGN-RACE-01` (4 concurrent callers converge on ONE pair)                                                                                      |
| 9   | external schema create + version stamp + instance marker                            | one Kysely `db.transaction()` (`ensureSchema`)                                             | `EXT-SCHEMA-ATOMIC-01` (failed marker write rolls back all DDL), `EXT-LADDER-04` (legacy half-init recovery)                                             |
| 10  | `importSnapshot` (both stores)                                                      | **documented exception** — see below                                                       | n/a                                                                                                                                                      |

## Documented exception: `importSnapshot`

The local→external snapshot import streams potentially large user/group/role sets with progress
callbacks; holding one transaction across the whole import would pin locks/memory for the duration
and (on MySQL) DDL-adjacent steps auto-commit anyway. **Compensating behaviour:** the import runs in
`upsert` mode and is idempotent — a crash mid-import is repaired by simply re-running _Resync_
(`identity_db_resynced`), which converges to the same end state; partial state is never read as
authoritative because cutover (`identity_db_cutover`) only happens after a completed import.

## Conventions

- Local (libSQL/Prisma): `$transaction` (array form for independent statements, interactive form
  when a write depends on a prior read) or a single atomic conditional `updateMany` where a
  check-then-act would race (§5.A5/A6/A9 pattern).
- External (PostgreSQL/Kysely): `db.transaction().execute(...)`.
- Race fixes are proven with the §12 harness (`test/support/concurrency/race.helper.ts`,
  self-tested by `RACE-SELF-*`) against real databases, not mocks.
