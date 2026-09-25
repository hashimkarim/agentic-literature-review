# Writing Workspace and Live SDK Check

## Scope and Revisions

- Application: LitAgent, `chat-reliability`, source commit
  `fbd7a465a684418c84d955d78ce02a8509755758`.
- UI commits: `95b84a8` (writing view persistence), `9fa8670` (workspace layout),
  `fbd7a46` (reading workspace preferences). All pushed to the task branch.
- Installed client: exact registry `@agenticdriver/sdk@0.1.0`, regular local
  `node_modules` directory, no sibling SDK source/symlink dependency. Bun lock:
  `sha512-GuJ+fENsGqF82jPs5/nlnA413/l8y06OiZpd7v1Y2AGI/qa7j3pZFtnhIVUGEooG/IdPzMvdY7nIi7QU594lPA==`.
- Host: `http://127.0.0.1:17433`; SDK owner reports source
  `23105e45e9cd00864722a29f3be02a3f1505c981`. This receipt does not certify that
  revision's hosted CI. No SDK checkout or dependency changes were made here.
- Explicit user selection: existing local Codex sign-in, `local-codex`,
  `gpt-6-luna`, host-fixed medium effort. No provider/model/account fallback.
- Actual app HTTP server and built React UI at `http://127.0.0.1:3886`, with a
  disposable research repo and two small synthetic source attachments. The
  browser used the app's same-origin API, never the SDK directly; no SDK CORS
  grant was needed. No manuscript, provider setting or source in the user's
  normal research repository was changed.

## Reproduction and Checks

Run the normal checks and build first:

```sh
bun run typecheck
bun run test
bun run build
```

Results: typecheck passed; 201 tests passed and two opt-in compiler tests skipped;
production build passed with the existing Vite large-chunk warning. Native T3
preview verified writing at 1920, 1440, 860 and 390 CSS pixels, active/open files,
collapsed folders, assistant tab, split ratio and panels after reload/reopening.
Keyboard divider resizing, mobile file-drawer controls, comparison restoration,
menu dismissal and nonblank PDF canvas pixels were checked. Existing standalone
browser regression scripts were updated, but were not executed in this session.
The new setup script also passed a standalone strict TypeScript check; missing
configuration, remote host, credential-bearing URL and occupied-port probes
were rejected before starting a server or making a model request.
Setup also verifies the actual API's repository root before importing data.

The opt-in setup creates synthetic data but makes **zero generation calls**:

```sh
LITAGENT_LIVE_TOKEN_FILE=/path/to/private/literature.token \
AGENTICDRIVER_URL=http://127.0.0.1:17433 \
bun scripts/prepare-writing-live-check.ts
```

Use only a host/account explicitly authorized for this check. The script reads
the token locally into the server environment; never paste it into the browser,
shell command arguments or receipts. It prints a nonsecret setup receipt with
the temporary directory, document/source IDs and child process-group ID. Choose
another port with `LITAGENT_LIVE_PORT` if occupied. The app server currently uses
its existing default listen address; run on a trusted development host, keep the
check short and stop the isolated process group afterwards. This is not a
public deployment or an authentication implementation.

In the native preview, enabled and saved `driver.local-codex` in Settings; all
other providers remained disabled. Clicked Refresh status. In Writing, explicitly
selected that connection and `gpt-6-luna`, selected only `synthetic-results.txt`,
and inspected the complete context preview before generating. The unrelated
`unselected.txt` sentinel and its 999 ms result were absent from the saved context
and output. The selected fixture described 100 simulated cases, 40 ms to 30 ms
median latency, 25% reduction, and no accuracy evaluation.

## Actual Live Runs

All timestamps below are UTC. There were four model requests in two app batches;
no retries, fallback, acceptance or manuscript mutation.

| App operation | SDK run ID | Result |
| --- | --- | --- |
| First draft, 15:58:58 | `af9975d2-48ab-4177-a4fc-0439fdcaa865` | Completed |
| First support review, 15:59:07 | `c61c1875-fadf-4d2f-8c7c-f66cca2d56f8` | Completed; overall draft rejected |
| Second draft, 16:00:24 | `56505c91-bd1d-471d-a435-1aeee688a98c` | Completed before cancellation |
| Second support review, 16:00:32 | `e216654b-fdeb-4ffd-a3f3-5fb03623ddec` | Cancelled at 16:00:34 |

First batch: `candidates_d185589f0265424085deeff3330fa6a0`, candidate
`candidate_6ee4f49e72580f7b`. UI progressed from drafting to review/completed.
The response supplied three exact-quote claims against the selected fixture;
the app validated source identity/revision and quotes. Clicking evidence opened
the correct attachment quote, line and revision. Accept remained disabled because
the overall review failed. The model said 56 words rather than the requested 50,
although the final prose is 50 whitespace-separated words after removing the
app-rendered citation footnote. All three individual support checks passed.
This is a real quality finding, not a successful review/acceptance certification.

Second batch: `candidates_b2407436cd054d0c886f0d7a0ebc12f8`, candidate
`candidate_4754a6bfe7b6ccc0`. Stop generation reached the active review request,
which the host recorded as cancelled. The app stored cancelled status with null
text, no acceptance and no later overwrite. Both batches survived page reload
without replay. No additional review or generation was started by reloading.

Final `main.tex` revision remained
`2ae383c96be7603346ded2fa2e05ddc7fbed3bcd2de71522518bf691ae50b32a`.
Public provider/settings/document/batch API responses were compared locally
against the credential and did not contain it. Browser storage held only view
preferences/document IDs, with no token/cookies or direct SDK requests. The
isolated app was stopped after confirming no running batches.

## Remaining Gaps

- **Discovery refresh is not qualified.** The current adapter fetches the SDK
  catalog at startup and retains it. The existing Refresh status action does not
  fetch a new remote catalog, and connected status is not a current health probe.
  AD-035 branch `agenticdriver-connection-setup` at `4f4be92` remains unmerged and
  untouched. Integrate/reconcile that work before claiming refresh/offline-health
  acceptance. These checks did not certify that separate branch.
- **Support vs. editing constraints:** the review currently combines source
  support and request compliance. The live reviewer rejected a supported draft
  over an incorrect word count. Separate deterministic prose-length checks and
  style feedback from factual support; preserve source-validation safeguards.
- Progress was app-level drafting/review state, not a token-streaming guarantee.
  The current app adapter does not persist remote SDK run IDs in its normalized
  run records; the IDs above came from the host's subject-scoped diagnostic JSONL
  and were correlated by phase and timestamps.
- No complete live Usagestat ingestion claim. Completed requests have reported
  token usage; the cancelled review has unknown/empty usage, not zero cost.
- The SDK host's documented inherited native instructions/skill descriptions
  still apply. No native tool calls were requested. Source selection checks here
  qualify app-supplied context, not the absence of inherited native instructions.
- No application auth migration, desktop packaging check, new SDK release,
  successful accepted live manuscript change or general model-quality guarantee.
