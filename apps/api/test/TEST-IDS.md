# Test-ID prefix registry (§6.10)

Every api test carries a stable ID prefix (`it('PREFIX-NN: …')`) so failures are greppable and
review comments can reference a test unambiguously. **Before adding a new prefix, check this
registry** — reuse the area's existing family; add a row when you genuinely introduce a new area.

| Prefix family                                                                                    | Area                                            | Lives under                                        |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------- |
| `API-AUTH-*` (`-INT`, `-SVC`, `-SSO`, `-SAML-BIND`, `-SESSION`, `-DTO`)                          | end-user auth + SSO completion                  | `test/unit/auth/`                                  |
| `API-ADM-*`, `API-ADM-USR-*`, `API-ADM-DASH-*`, `API-ADM-SESS-*`                                 | admin auth/users/dashboard/session-list         | `test/unit/admin-*`                                |
| `API-SES-*`                                                                                      | admin session service/codec                     | `test/unit/admin-auth/`                            |
| `HMAC-CODEC-*`                                                                                   | shared session codec                            | `test/unit/common/`                                |
| `API-PWD-*`                                                                                      | password hashing/dummy-hash                     | `test/unit/common/` (was admin-auth)               |
| `LOCK-*`, `LOCK-RACE-*`, `BAN-*`, `RATE-*`, `TARPIT-*`                                           | auth-protection (lockout, IP-ban, limiter)      | `test/unit/auth-protection/`                       |
| `API-BST-*`                                                                                      | bootstrap                                       | `test/unit/bootstrap/`                             |
| `API-SAML-*` (`-BUILD`, `-PARSE`, `-POST-PARSE`, `-SIGN`, `-INT`)                                | SAML request/response pipeline                  | `test/unit/saml/`                                  |
| `API-SLO-*`, `BC-*` (`-SOAP`, `-BUILD`, `-PROP`, `-PROBE`, `-CONFIG`)                            | single logout + back-channel                    | `test/unit/saml/`                                  |
| `API-IDP-*` (`-VAL`, `-SVC`, `-MAP`, `-ADM`, `-ENC`, `-CRYPTO`, `-SAML`)                         | IdP settings + cert lifecycle                   | `test/unit/idp-settings/`                          |
| `CERT-ROT-*`, `CKD-*`                                                                            | cert auto-rotation + CertKindDescriptor goldens | `test/unit/idp-settings/`                          |
| `API-SPC-*`                                                                                      | SP connections                                  | `test/unit/sp-connections/`                        |
| `API-SYNC-*` (`-SVC`, `-INT`, `-VAL`, `-REPO`, `-MAP`, `-CTRL`), `API-SCH-*`, `MAS-*`, `OAUTH-*` | sync, schedules, multi-source, OAuth            | `test/unit/sync/`                                  |
| `API-CON-*`                                                                                      | API connections                                 | `test/unit/api-connections/`                       |
| `API-IDN-*` (`-MAN`, `-ADM`, `-TBL`)                                                             | identity manual CRUD + admin                    | `test/unit/identity-admin/`, `test/unit/identity/` |
| `PARITY-*`, `EXT-*` (`-SCHEMA`, `-LADDER`, `-PGSCHEMA`, `-SVC`), `RES-CB-*`, `IDN-MIRROR-*`      | identity stores (local/external/PGlite)         | `test/unit/identity/store/`                        |
| `API-AUD-*`, `AUDIT-REG-*`                                                                       | audit query/export + event registry             | `test/unit/audit/`                                 |
| `SLG-*`                                                                                          | secret-leak guard (§16)                         | `test/unit/common/`                                |
| `MIG-*`, `MIG-GUARD-*`, `SQL-SPLIT-*`, `OPS-*`                                                   | local migrator + ops                            | `test/unit/prisma/`                                |
| `CFG-*`, `ENV-*`                                                                                 | config parsing + env validation                 | `test/unit/config/`, `test/unit/common/`           |
| `RACE-SELF-*`                                                                                    | §12 race-harness self-test                      | `test/unit/support/`                               |
| `RUNPOOL-*`                                                                                      | shared run-pool util                            | `test/unit/common/`                                |
| `API-REDFLT-*`                                                                                   | redacting exception filter                      | `test/unit/common/`                                |
| `EDGE`, `API-FIX-*`                                                                              | grab-bag edge cases / pinned fixes              | various (prefer a domain prefix for new tests)     |

Web tests use `WEB-*` families (`WEB-EVG-*` evergreen/static guards, `WEB-ADM-*`, `WEB-I18N-*`,
`WEB-RSP-*` responsive, `WEB-IDN-*` identity UI, `WEB-MAS-*` multi-source, `WEB-SYNC-*`) under
`apps/web/test/`; shared-package tests use `SH-*` under `packages/shared/test/`.

Characterization/golden suites: `sync.service.characterization.spec.ts` (named jest snapshots),
the `CKD-*` CertKindDescriptor goldens, and the PGlite `PARITY-*` matrix are behaviour fixtures —
a diff there means a behaviour change, not a test to "fix".
