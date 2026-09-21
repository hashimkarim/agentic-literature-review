# Application Authentication Plan

Status: planned, not implemented. The SDK coordination handoff reports AD-013
closed after all five [CI rows](https://github.com/hashimkarim/agenticdriver/actions/runs/35592627050)
passed for `cd3f57f85c0f06be63637baf3d774f70af0990f0`, including native
Better Auth/AuthYard contracts on Node 24/26, installed-package and cross-language
TLS checks. The SDK CI gate is cleared; these checks have not been rerun here.
This does not certify LitAgent's migration, a live AuthYard project, account or
model run. AD-014 container deployment remains unpublished in this handoff and
is not an accepted dependency.

## Ownership And Dependencies

Better Auth owns LitAgent users, credentials, organizations, sessions, OAuth
clients and consent in application-owned persistent SQL. AuthYard provides
management through its existing `controlPlane` plugin, not another identity
backend. Research library/project permissions and accepted artifacts stay here.
AgenticDriver owns execution and authenticates explicitly authorized SDK access;
provider account bindings are not inferred from the signed-in LitAgent user.

The SDK's tested baseline is Better Auth and `@better-auth/oauth-provider`
exactly 1.7.3, with packed `@authplane/better-auth` 0.2.0, protocol 1, Node 24+.
The handoff records the tested connector artifact SHA-256 as
`4df6857225eb9a34502716ee58883392b090950a4d3651256ed5c8f371ac5bc6`;
verify downloaded/packed bytes against it before installation.
Do not guess a registry release. AuthYard's working docs describe
`@authyard/better-auth` 0.3.0; adopting it requires a reviewed committed artifact,
its supported matrix and the control-plane-first migration. Do not install
from a sibling dirty checkout. Record revision, checksum and license with the
chosen artifact. Recheck these gates before implementing.

Contract references to reread before implementation:

- SDK `/mnt/shared/Git/agenticdriver/docs/authentication.md` at the reviewed
  handoff revision: `agenticdriver/better-auth`'s `betterAuthAuthentication`,
  browser-safe `agenticdriver/pairing`'s `BetterAuthPairingClient`, and
  `AgenticClient.token` per-request resolver.
- The organization migration renames those external imports to
  `@agenticdriver/sdk/better-auth`, `@agenticdriver/sdk/pairing` and
  `@agenticdriver/sdk/client`. Follow the [package migration checklist](agenticdriver.md#scoped-package-migration-preparation)
  after the exact registry artifact is verified; this plan does not change
  installed dependencies or qualify another AuthYard connector.
- AuthYard `/mnt/shared/Git/authyard/README.md`, `docs/connector-protocol.md`,
  `docs/better-auth-compatibility.md` and `docs/authyard-migration.md`.
- Management control plane: `https://alpha.authyard.dev`.

## Ordered Implementation

1. SDK platform CI is cleared for the pinned commit above. Confirm the chosen
   AuthYard artifact/control-plane compatibility and verify its checksum.
   Coordinate integration of AD-035's isolated connection branch;
   it has not been integrated into this application's active branch.
2. Establish a supported Node 24+ auth host for local web and packaged desktop.
   Bun tooling does not establish connector runtime compatibility. Verify
   Electron launch/install behavior and persistent auth storage separately from
   rebuildable `.litagent/index.sqlite`; never commit credentials or auth DBs.
   Resolve how hosted management reaches the local app without exposing an
   unauthenticated listener or relying on public access to localhost.
3. Add Better Auth and the supported connector, then apply reviewed migrations
   for identity, OAuth/device grants, nonce, outbox and delivery tables. Test
   upgrade/restart and backups. Keep exact trusted origins, secure production
   cookies, explicit app access checks and rate limits on all auth/device routes.
   Place the connector after plugins that install auth after-hooks.
4. Provision a separate public native OAuth client per device and a confidential
   introspection client, explicitly linked to the driver resource. Disable
   anonymous dynamic registration. Use the OAuth device grant, not Better Auth's
   first-party device-session flow. Build signed-in consent showing device,
   resource and requested scopes, with deliberate approve/deny; opening a URL
   must never approve. Preserve existing provider IDs and explicit enablement.
5. Map the exact issuer/client/user tuple to existing canonical identities and
   current app grants. Intersect consented scopes, current grants and host
   resource definitions. Service clients get explicit service subjects, never
   the owner's identity. Corpus grants do not bypass paper/revision checks.
6. Use SDK pairing and per-request token resolution without a parallel token
   backend. Store refresh credentials in protected backend/desktop storage;
   browser access tokens stay short-lived and in memory. Do not use URLs, logs,
   localStorage or IndexedDB for credentials. Serialize rotation across device
   processes, atomically replace secrets and require re-pairing after uncertain
   rotation rather than retrying. Disconnect revokes retained credentials and
   removes the app grant. Make in-flight cancellation an explicit policy;
   revocation does not automatically stop admitted foreground work.
7. Keep durable jobs deferred. If later enabled, implement the required
   `resolveJobPrincipal` using a stable revocable app authorization reference,
   never a persisted access/refresh token. Preserve subject and accepted scope
   ceiling across restart and recheck current permissions. Do not add implicit
   execution deadlines or treat lease renewals as model progress.

## Acceptance Gates

- Real migrated SQL and actual SDK/app HTTP tests: two users/devices, cross-user
  denial, wrong issuer/resource/origin, least privilege and no credential leaks.
- Consent approval/denial, polling slowdown, expiry/cancel, serialized refresh,
  reuse rejection, uncertain rotation, disconnect and restart persistence.
- AuthYard outage: ordinary sign-in/introspection independent of management;
  management verification fails closed and event delivery retries durably.
- Settings refresh and pairing preserve provider/account/model selection and
  existing runs; SDK authentication and static-token modes are not combined.
- Existing chat/citation regression tests and canonical research data remain
  unchanged. Run typecheck, tests, build and browser checks for the auth UI.
- Record fixture, platform and live acceptance separately. No live AuthYard
  project/account certification is implied. Antigravity remains blocked by
  capability isolation, not sign-in; no account or billing fallback is allowed.

AuthYard console support for OAuth-device management must be verified separately;
the connector's identity/session management is not proof that UI exists.
