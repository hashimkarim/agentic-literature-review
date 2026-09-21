# Optional provider and account catalog

The existing `AgenticDriverCatalog.discover()` response now includes an optional
`driverCatalog` field on SDK provider entries. It uses the installed SDK's
`agenticdriver/catalog` helpers for provider/account identity, reviewed icon
manifests, and account quota observations. The existing rendered provider label,
local provider discovery, workflow enablement, paper authorization, citation
validation, and artifact acceptance remain unchanged.

The ordinary server startup has no account catalog configuration and returns the
SDK's “Account not linked” and unbound quota fallbacks. No Usagestat credentials,
provider probes, raw administrative catalog reads, or quotas are inferred from
`AGENTICDRIVER_URL`, a provider name, an email address, or workflow metadata.

## Trusted server integration

`agenticDriverCatalogFromEnvironment(settings, configuration)` optionally accepts
an `AgenticDriverCatalogConfiguration`. A server can also supply it as the fourth
`AgenticDriverCatalog` constructor argument. The configuration belongs to one
trusted host and one authenticated subject. Return that catalog only to the same
subject; a server shared by several users must create and authorize separate
subject-scoped catalogs. Do not install one user's configuration in LitAgent's
global catalog and expose it to other users. This slice does not add multi-user
authentication or change the app's existing access boundary.

```ts
import { AgenticDriverCatalog, agenticDriverCatalogFromEnvironment } from "@litagent/agents/agenticdriver";

// All values and services below come from the authenticated server session and
// trusted deployment configuration, never a browser's settings or request body.
const catalog = await agenticDriverCatalogFromEnvironment(settings, {
  hostId: trustedHost.id,
  subject: session.subject,
  maxAgeMs: 5 * 60_000,
  bindingFor(providerId) {
    const account = bindings.currentAuthorizedAccount(session, trustedHost.id, providerId);
    return account ? {
      identity: {
        hostId: trustedHost.id,
        provider: providerId,
        accountId: account.id,
        subject: session.subject,
      },
      accountLabel: account.label,
    } : undefined;
  },
  metadata: authorizedProviderMetadata,
  assets: reviewedAssetCache.manifest,
  accountLimits: (identity) => usagestat.accountLimits(identity),
});
```

The optional `accountLimits` reader is the SDK's trusted, account-scoped lookup.
It must enforce its own configured Usagestat account bindings. Never substitute
raw `limits()` or `usage()` responses. The application checks all four identity
fields before reading, checks the current binding again after the asynchronous
read, and lets the SDK validate the returned receipt's full identity before
displaying metrics. Distinct driver instances retain distinct account IDs and
labels even when they share the same provider branding.

Provider metadata matches only an explicit discovery `usageStatId`. Unknown or
ambiguous matches use SDK fallbacks. Raw metadata, local icon paths, subject and
host identifiers, upstream account identifiers, and exception text are not part
of the app contract. Reviewed assets retain same-origin content-hash URLs and
license notices. Supply a manifest only when its matching asset cache is already
served at those URLs; no asset route, remote image proxy, or icon download is
added here. Missing or invalid assets return the SDK's text fallback.

## Refresh and revocation

The environment factory performs an initial refresh only when trusted catalog
configuration is provided. With no SDK environment it returns the ordinary
`AgentProviderCatalog`, so narrow the result before SDK-specific updates:

```ts
if (catalog instanceof AgenticDriverCatalog) {
  await catalog.refreshCatalog(); // An explicit refresh; there is no polling loop.
  catalog.setCatalogConfiguration(); // Revoke this subject's catalog configuration.
}
```

`setCatalogConfiguration(next)` replaces the configuration; a failed replacement
also revokes the previous configuration. None of these catalog methods executes
a provider.

`bindingFor` must consult the current authorized binding and return `undefined`
when access is revoked. It may return a freshly allocated object each time;
identity and label comparisons use values. Binding changes, configuration
replacement, newer refreshes, and semantic provider settings changes discard
older observations or pending results. A rejected refresh clears previous
metrics and returns the SDK's fixed error/unbound labels. Resolver failures are
unbound and do not reveal the exception.

Freshness is recalculated on every `discover()` or adapter description, including
quota reset boundaries. `fresh` is an observation age, not permission to run or a
promise of remaining capacity. Cached/estimated quality remains explicit, stale
values remain historical, and invalid/future snapshots have no metrics. Quotas
never alter explicit provider enablement or accept a research artifact.

## Verification

The implementation is tracked in
[LitAgent issue #3](https://github.com/hashimkarim/agentic-literature-review/issues/3).
It was developed against committed SDK AD-031 revision
`99ec97a576621a8b4742652d4cfa824c77330573`, installed from the immutable npm archive
with SHA-256
`f2944a5996eed3923ad0e29f4245bcb88944c77a0ce3549b08ae3cfb51dfd76c`.

Run `bun run typecheck` and `bun run test`. The test command first resolves
`agenticdriver/catalog` and the other SDK entries through the actual Vitest/Vite
configuration, requiring an installed package inside the current checkout.
Catalog fixtures cover account isolation, trusted binding scope, missing assets,
SDK fallback states, freshness/reset boundaries, refresh failures, replacement,
revocation, and out-of-order completions. A loopback SDK host fixture exercises
the existing environment factory. Existing selected-paper and citation tests
remain in the full suite. No live providers or account credentials are used.
