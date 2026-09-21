# Repository testing

Test metadata lives beside the tests in versioned `*.case.yaml` and
`*.suite.yaml` files. [`.ci/test-catalog.mjs`](../.ci/test-catalog.mjs) loads these
through `test/harness/manifests.mjs` and retains the existing UT tier definitions.
The CLI selects and reports work; Node, Playwright, pytest and unittest execute
it. Run `pnpm install --frozen-lockfile` before using the CLI.

## Configuration and CI policy

Use one adjacent `.case.yaml` for each browser spec or standalone scenario.
Contract sidecars also identify the scenario inside the JSON source. Module
unit tests use one `.suite.yaml` discovery rule and inherit the execution policy
of its `entryPoint` (`ut.host` or `ut.guest`); individual unit tests need no YAML.
Paths are relative to the configuration file. For example:

```yaml
version: 1
id: e2e.browser.example
source: example.spec.ts
owner: browser
layer: e2e
surface: browser
runner: playwright
capabilities: [session]
llm:
  mode: stub
supportedExecutors: [native, jiuwenswarm]
timeoutSeconds: 600
requirements: [build, clean-worktree]
ci:
  pr:
    executors: [jiuwenswarm]
    required: true
  daily:
    executors: [native, jiuwenswarm]
    required: true
resultPath: browser-example
```

`llm.mode: stub` means the test uses controlled model responses, without a real
model provider. It does not select the application executor or mean that all
services are mocked. `none` means no model call, `real` means a real provider,
and `unreviewed` is reserved for explicitly quarantined legacy coverage.
Real and quarantined tests require named opt-in gates and cannot enter PR policy.
Only environment variable names belong in `gates`; never put credentials in YAML.

`supportedExecutors` states capability; `ci.pr` and `ci.daily` state scheduling.
Omitting a policy excludes that case from that profile. An empty supported list
means executor-independent work, whose CI policy uses `[independent]` and runs
once. PR/daily profiles reject `--executor` overrides. Manual selections retain
the declared default executor and support explicit `--executor both`.

`required: true` makes FAIL/BLOCKED/SKIPPED/NOT_RUN fail the gate. Nonblocking
entries require `required: false` and a reviewable `reason`; their actual outcomes
remain in the report and yield `passed-with-observations`, not PASS outcomes.
Outside PR/daily profiles every selected entry is required, including contracts.
Unknown fields, duplicate YAML keys/IDs/source ownership, invalid policy backends,
missing sources and missing scenario configurations fail validation.

The PR policy has 7 required execution entries; daily has 76 required and 54
observational entries after backend expansion. These are execution entries, not
framework test counts.

The initial PR policy contains both UT tiers, native deterministic agent ST, and
four JiuwenSwarm browser scenarios: first run, plugin composition, execution
management and result delivery. Daily policy adds reviewed deterministic browser
scenarios on both executors and the seven native API journeys. Its 54 contract
entries (27 scenarios × two executor labels) are observational until isolated
targets and platform-appropriate reviewed baselines are provisioned. They remain BLOCKED without
those prerequisites; this is not contract coverage. Real-model, hardware and
legacy cases remain explicit opt-ins. Existing product failures remain failures.

GitHub `ci.yml` uses the PR policy; `test-daily.yml` calls the same reusable
`test-policy.yml` daily at 00:17 UTC and supports manual dispatch. Scheduled runs
start only once the workflow is on the default branch. PR runs trigger on opened,
synchronize and reopened events; pushes to `main`/`master` and manual CI dispatch
use the same policy. Workflows provision
infrastructure; case YAML owns selection. CodeArts retains its existing native
compatibility commands. Inspect the exact matrix with `pnpm test:list --profile
pr --json` or `--profile daily`.

## Commands and coverage

| Command | Scope |
|---|---|
| `pnpm test:pr` / `pnpm test:daily` | Execute the case-configured gate or daily policy. |
| `pnpm test` | Compatibility default: build, binary-script tests, all workspace package tests. Same scope as before this migration; does **not** mean all repository tests. |
| `pnpm test --profile local` | Host UT tier (including Python adapter and tooling tests), then deterministic in-process ST smoke. Host UT installs/builds prerequisites. |
| `pnpm test --profile full --executor both` | Both UT tiers, ST, individual browser/API journeys, contract scenarios and explicit live/hardware/quarantine gates. Independent UT runs once. |
| `pnpm test:list --json` | Static asset inventory, selected entries, commands and preflight blockers. No test imports, framework execution, live requests, or dependency installation. |
| `pnpm test:doctor --case e2e.child-workspace` | Read-only preflight; exit 2 for missing prerequisites. READY means declared prerequisites are present, not that services or tests were verified. |
| `pnpm test:check` | Catalog/tier, ownership, missing/duplicate/empty/stale asset and browser metadata validation. |
| `pnpm test --layer st --capability permission` | Intersection of layer and capability. |
| `pnpm test --layer e2e --surface browser --executor jiuwenswarm` | Browser leaves using the JiuwenSwarm stack configuration; requires its gateway/management URLs. |
| `pnpm test --case e2e.child-workspace --executor native` | One standalone API journey; requires built, committed source. |
| `pnpm test:tooling` | Discovery, selection, reporting and HTTP contract tool regression tests. |
| `pnpm adapter:test` | Adapter pytest suite without the two explicitly gated live modules. |

Use `--case` repeatedly to select named cases. `--tag` retains CI's AND semantics
between flags and OR semantics inside a comma-separated flag; `--exclude` takes
a case ID. Unknown IDs/options and empty selections fail. `--executor both`
retains unsupported combinations as BLOCKED; it never substitutes native for
JiuwenSwarm. Existing standalone drivers support native only. Browser leaves
are identified by `e2e.browser.<relative-spec-name>`. Split real and deterministic scenarios into separate spec files. Framework test titles and parameterization remain
in the Playwright report. Aggregate `e2e.mocked`, `e2e.real`, `e2e.legacy` IDs
remain available without double-running their selected leaves.

`full` continues independent entries after failures. `--fail-fast` records the
remaining entries as NOT_RUN. Within a UT tier, a failed prerequisite stops
execution; independent workloads continue unless fail-fast is requested.
The UT tier passes `--no-bail` to recursive workspace tests so other packages can finish; the compatibility default retains its original pnpm failure behavior.

## Where tests belong

| Asset | Location / discovery |
|---|---|
| Node module UT | Colocated `src/**/*.test.ts`; mapped exactly to `dist/**/*.test.js` before execution. Runner script self-tests are included recursively. |
| Web UT | `apps/web/tests/**/*.test.ts` and `**/*.test.tsx`, executed by tsx. |
| Python | `services/<service>/tests/`, using that service's unittest/pytest discovery and configuration. |
| In-process cross-module ST | `test/st/agent-runtime/`. Importing the native agent directly is ST. |
| Browser journeys | `test/e2e/browser/**/*.spec.ts`; helpers stay in its `helpers/` subdirectory. Only this directory and spec pattern are visible to Playwright. |
| Public API/Runner journeys | `test/e2e/api/*-journey.mjs`, one stable catalog ID per existing driver. These drivers also own any local stack restart/fault lifecycle. Split out `test/e2e/local-stack/` if a future driver warrants it. |
| HTTP contract scenarios | `test/contract/cases/*.json`; L1 scenarios are ST, L2 Run journeys are E2E. Shared replay code and its unit tests remain in `test/contract/`. |
| Test infrastructure | `test/harness/*.test.mjs`, separately collected by Node. |
| Shared fixtures | `test/fixtures/`; fixture servers are not independent tests. |

Add a suite discovery rule for a new module or framework, not individual unit
case names. Add an adjacent case configuration for a standalone driver or browser
spec. E2E-META comments explain purpose, steps and external dependencies; YAML
owns machine-readable layer, model mode, capabilities and CI policy. Keep the
existing `@mocked`/`@real` browser tags consistent with that policy. Do not add
new legacy quarantine entries. Explicit asset exclusions need a path and
reviewable reason; stale exclusions fail validation.

Node/Web runners pass explicit file arguments, without shell-dependent globs.
A missing compiled test or a compiled test whose source was deleted fails with
instructions to clean the affected `dist` and rebuild. This mapping check is
not a substitute for building the candidate before a formal run.

## Gates and external targets

Selection never enables a gate. A full selection lists gated work as BLOCKED
and returns nonzero if it remains blocked.

- Real models: `CI_ALLOW_REAL=1` plus the case's named credentials/endpoints.
- Legacy browser quarantine: `CI_ALLOW_LEGACY=1`.
- Ascend workload: `CI_ALLOW_NPU=1`, `SCIENCE_AGENT_NPU_PYTHON`, and actual
  device/runtime availability. The separate npu-broker API journey uses fake
  hardware and does not certify an Ascend device.
- Adapter scripted live gateway: `CI_ALLOW_ADAPTER_LIVE=1`,
  `JIUWENSWARM_GATEWAY_URL`, `JIUWENSWARM_LIVE_SCENARIO`; assemble the stub and
  gateway as documented in `services/adapter/tests/test_gateway_live.py`.
- Adapter real model: `CI_ALLOW_REAL=1`, `REAL_LLM_BASE_URL`, `REAL_LLM_MODEL`,
  `REAL_LLM_KEY`, both JiuwenSwarm gateway and management URLs.
- Contract replay: `CI_ALLOW_CONTRACT=1`, `E2E_BASE_URL`, `E2E_API_TOKEN`,
  `E2E_TARGET_EXECUTOR`, `E2E_CONTRACT_BASELINE`. Supply a fresh isolated target
  and a reviewed baseline with every selected scenario/step. These existing
  drivers mutate projects/settings and do not provision the target. The
  executor label is operator-declared; reports explicitly identify this
  limitation rather than claiming independent executor verification.

The target branch now supplies `test/contract/baselines/legacy-linux.json`,
including L2 coverage. Each selected scenario still requires a complete, reviewed
comparison baseline appropriate to the target platform; the daily workflow does
not yet provision contract targets or choose that baseline. Recording is an
explicit baseline-authoring operation, **not a passing comparison**:
`node test/contract/run.mjs --case <scenario-id> --record <path>`.
An empty selection, absent baseline case/step or error-bearing baseline fails
before network access. Keep existing product failures visible; do not record
failing responses as expected behavior to obtain a green result.

The memory-graph suite also contains opt-in Neo4j checks, controlled by
`SCIENCE_AGENT_MEMORY_GRAPH_TEST_NEO4J` and its `_PASSWORD` companion; pytest's
skip details remain part of the evidence. Browser startup refuses a checkout-level `.env`, because the existing product
startup script would source it and could override the selected executor, ports
or data directory. Supply explicit environment variables in an isolated
checkout. Formal browser/API runs require the committed candidate and isolated services described in the
[E2E skill](../.agents/skills/e2e-testing/SKILL.md).

## Evidence and compatibility

Each invocation writes `.test-runs/<timestamp-id>/summary.json`, selected IDs,
revision and dirty flag, requested/actual executor information, command logs,
exit codes, timings and evidence paths. CI can set `CI_RESULTS_DIR`; run folders
then live there and compatibility summaries are published at the existing
layer result path. Outcomes are PASS, FAIL, BLOCKED, SKIPPED, NOT_RUN. Unstarted
work has no actual executor. Browser results retain the raw Playwright JSON,
including every attempt and flaky count. Framework-reported skips (including nested UT logs) are not reported as a fully passing selection. A zero exit without journey steps, contract
comparisons or a nonempty browser result cannot certify success.

`ci:list`, `ci:run`, `ci:catalog:check`, `ci:ut[:host|:guest]`, `ci:st[:real|:npu]`
and `ci:e2e[:real|:legacy]` use the shared selector/runner. `ci:ut` still combines
exactly the host and guest tiers. Root `check` retains its previous component
commands. Manual invocations retain the upstream `CI_E2E_BACKEND=legacy|jiuwenswarm`
compatibility setting; explicit `--executor` and PR/daily YAML policy take precedence.
`ci:e2e` still means the mocked browser subset. CI's
`CI_E2E_PREPARE_ONLY=1` performs dependency setup and reports phase `prepare`,
NOT_RUN tests and `prepared` status; it is not test coverage. The existing
`CI_E2E_PREPARED=1` path uses those pinned dependencies.

The pinned browser package/lock/config remain at `test/e2e.package*.json` and
`test/playwright.config.ts`; `.e2e/` remains the disposable install directory.
After config changes, run `node test/sync-e2e.mjs --write`, then
`npm install --prefix .e2e`. Framework-expanded discovery can be checked with:

```bash
npm --prefix .e2e run test:list
npm --prefix .e2e run test:real:list
npm --prefix .e2e run test:legacy:list
```

These list commands load spec declarations but do not execute journey bodies.
They differ from the entirely static `pnpm test:list` inventory.

`test/harness/migration.json` records source revision, old/new paths, browser
declarations and contract scenario IDs. The migration regression test checks
identity preservation, rather than merely matching an aggregate count.
Historical `node test/api/...` and shell smoke paths moved as recorded there;
use the catalog case command or the new path. No product assertions were
removed or rewritten to accommodate existing failures.

Test filenames describe the object and scenario (for example,
`session-stop-isolation.spec.ts`), never an issue number. Catalog validation
rejects issue-number filenames. Issue links may remain in comments for history.
Browser IDs follow the renamed file stems; `browserFileRenames` in the migration
record maps the previous names.

Two obsolete browser declarations were explicitly retired after the structural
migration: the unconditional persistent-kernel teardown placeholder, and the
fixme targeting the removed manual paper-search form. Their original identities
remain in `migration.json` with reasons and replacement coverage or a coverage
gap. The latter still needs a current Agent/MCP disabled-connector feedback test;
its deletion does not establish that behavior as covered. Browser collection
initially changed from 87 to 85 tests. Integration with target revision `9670568`
also preserves its three new browser files: the current comparison is 90 upstream
tests versus 88 retained tests in 47 files. The same two approved retirements
account for the entire difference; `migration.json` records both snapshots.
