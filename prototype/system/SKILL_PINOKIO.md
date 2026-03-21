---
name: pinokio
description: Discover, launch, and use apps and tools for the current task.
---

# Pinokio Runtime Skill (pterm-first)

Use this skill for runtime control of Pinokio apps.
Do not ask users to manually install, launch, or call APIs when `pterm` can do it.

## Control Plane

Assume `pterm` is preinstalled and up to date.

### pterm Resolution (External Clients)

If running outside Pinokio's own shell, do not assume `pterm` is on `PATH`.

If `pterm` is not already executable, use the first executable match from these sources:

- Pinokio-managed path from `~/.pinokio/config.json` file's `home` attribute:
  macOS/Linux: `<home>/bin/npm/bin/pterm`
  Windows: `<home>\\bin\\npm\\pterm`
  Optional fallback: `<home>/bin/pterm`

- Control-plane path lookup:
  `GET http://127.0.0.1:42000/pinokio/path/pterm`
  If loopback is unreachable and `access` exists in `~/.pinokio/config.json`, retry the same request against `<protocol>://<host>:<port>`.

- Generic local lookup:
  `which pterm` / `where pterm`

Normalize whichever path you resolve before use.
- On Windows, if the resolved path has no executable Windows extension, prefer a sibling `.cmd` or `.ps1`.

Failure handling:
- `EPERM` / `EACCES` / sandbox denial: treat as a client permission problem, ask for permission first when possible, and rerun the same probe or `pterm` command after permission is granted.
- timeout / connection refused / DNS failure: report that the Pinokio control plane is unreachable rather than claiming `pterm` is uninstalled.
- Only report "`pterm` unavailable" when the config/home-derived path, control-plane path resolution, and local path checks all fail.

Use direct `pterm` commands for control-plane operations:

`pterm search`, `pterm status`, `pterm run`, `pterm logs`, `pterm upload`, `pterm which`, `pterm stars`, `pterm star` / `pterm unstar`, `pterm registry search`, `pterm download`

Do not run update commands from this skill.
Once a Pinokio-managed app is selected, treat `pterm` and the launcher-managed interfaces as the source of truth for lifecycle and execution. Do not switch to repo-local CLIs or bundled app binaries unless the user explicitly asks for CLI mode.

## How to use

Follow these sections in order:
1. Use Search App first.
2. Only use Registry Fallback if Search App found no suitable installed app and the user approved it.
3. Then use Run App.
4. Then use API Call Strategy if the app exposes an automatable API.

### 1. Search App

- Resolve by `pterm search`.
- Build one primary query from user intent:
  - explicit app name/vendor if user provided one
  - otherwise 2-4 high-signal capability tokens (example: `tts speech synthesis`)
- Query hygiene:
  - remove duplicate/filler words (`to`, `for`, `use`, `app`, `tool`, `service`)
  - do not send full sentences
- Run primary lookup:
  - if query has 3+ terms: `pterm search "<query>" --mode balanced --min-match 2 --limit 8`
  - if query has 1-2 terms: `pterm search "<query>" --mode balanced --min-match 1 --limit 8`
- If user provided a git URL, extract owner/repo tokens and run `pterm search` with those tokens first.
- Useful-hit threshold:
  - for 3+ term queries: candidate has `matched_terms_count >= 2` (if available)
  - for 1-2 term queries: candidate has `matched_terms_count >= 1` or clear top score
- If no useful hits, run one fallback:
  - `pterm search "<query>" --mode broad --limit 8`
- Deterministic ranking:
  - First, rank by runtime tier:
    - relevant apps with `ready=true`
    - otherwise relevant apps with `running=true`
    - otherwise relevant offline apps
  - This runtime priority applies across all relevant candidates, not just the same app on different machines.
  - If multiple different apps can satisfy the request, prefer the already-ready one over launching another offline app.
  - Within the selected runtime tier, rank by user preference:
    - exact `app_id`/title match (for explicit app requests)
    - `starred=true`
  - Within that same tier, use the remaining tiebreakers:
    - higher `matched_terms_count` (if available)
    - higher `launch_count_total` (if available)
    - more recent `last_launch_at` (if available)
    - higher `score`
- If the top candidate is not clearly better than alternatives, ask user once with top 3 candidates.
- If a suitable installed app is found, select it and continue to Run App.
- Search results may include apps from other reachable Pinokio machines:
  - remote results use `app_id` in the form `<app_id>@<source.host>`
  - `source.local=false` means the result is from another machine
  - treat remote results as separate apps; do not merge them with the local app of the same name

### 2. Registry Fallback

- Only use this section if Search App found no suitable installed app.
- Ask the user once whether to search the Pinokio registry for installable apps.
- Only after the user says yes:
  - run `pterm registry search "<query>"`
  - present the best candidates
  - after the user selects one, run `pterm download <uri>`
  - if `pterm download <uri>` fails with `already exists`, ask the user for a local folder name and retry with `pterm download <uri> <name>`
  - if the user wants a specific local folder name or another copy of the same repo, use `pterm download <uri> <name>`
  - then run the downloaded app with `pterm run <local_app_path_or_name>`
- Do not use `pterm run <url>` for the registry flow.

### 3. Run App

- Once you have a selected app, use `pterm status`.
- Poll every 2s.
- Use status fields from pterm output:
  - `path`: absolute app path to use with `pterm run`
  - `running`: script is running
  - `ready`: app is reachable/ready
  - `ready_url`: default base URL for API calls when available
  - `external_ready_urls`: optional ordered non-loopback app URLs for caller-side access; use them only when `ready_url` is missing or unusable due to loopback restrictions
  - `state`: `offline | starting | online`
  - `source`: machine identity for results from other reachable Pinokio machines
- Use `--probe` only for readiness confirmation before first API call (or when status is uncertain).
- Use `--timeout=<ms>` only when you need a non-default probe timeout.
- Treat `offline` as expected before first run.
- If `app_id` contains `@<host>` or `source.local=false`, the app is remote:
  - treat `path` and `ready_url` as source-local fields, not caller-usable local paths/URLs
  - use `external_ready_urls` in order for caller-side API access when available
  - use `pterm run <app_id>` for remote launch; do not use a remote machine's `path` value as a local path
  - for remote path-based tasks:
    - this applies only when the task expects filesystem paths such as `/path/to/file`
    - do not pass local paths from this machine to the remote app
    - first run `pterm upload <app_id> <file...>`
    - then use the returned remote `path` values
- If app is offline or not ready, run it:
  - For remote apps, run `pterm run <app_id>`.
  - Otherwise run `pterm run <app_path>`.
  - If the launcher has no explicit default item or the launch action depends on current menu state, infer one or more ordered selectors from the launcher's current menu and pass them via repeated `--default`.
  - Prefer stable launcher selectors such as `run.js?mode=Default`, then broader fallbacks like `run.js`, then installation fallback like `install.js`.
  - Continue polling with `pterm status <app_id>`.
  - Default startup timeout: 180s.
- Success criteria:
  - `state=online` and `ready=true`
  - use `ready_url` by default when it exists and is caller-usable
  - if `ready_url` is missing, or it fails because the client cannot access loopback, and `external_ready_urls` exists, try those URLs in order
  - missing `external_ready_urls` is normal; it usually means network sharing is off
- Failure criteria:
  - timeout before success
  - app drops back to `offline` during startup after a run attempt
  - `pterm run` terminates and status never reaches ready
  - on failure, fetch `pterm logs <app_id> --tail 200` and return:
    - raw log tail
    - short diagnosis

### 4. API Call Strategy (generated once, reused)
- Resolve path roots before writing agent-owned files:
  - prefer the current working directory when it is the active writable task/workspace folder
  - resolve `PINOKIO_HOME` with `pterm home` when fallback global storage is needed
- Generated client location:
  - local default: `<current_working_directory>/pinokio_agent/clients/<app_id>/<operation>.<ext>`
  - fallback: `<PINOKIO_HOME>/agents/clients/<app_id>/<operation>.<ext>`
- Output location:
  - local default: `<current_working_directory>/pinokio_agent/output/<app_id>/...`
  - fallback: `<PINOKIO_HOME>/agents/output/<app_id>/...`
- First run for `<app_id>/<operation>`:
  - inspect docs/code to infer endpoint + payload
  - generate minimal HTTP client file (`js`/`py`/`sh`)
- Later runs:
  - reuse existing generated client file directly
- Regenerate only if request indicates contract mismatch:
  - 404/405 endpoint mismatch
  - 400/422 payload/schema mismatch
  - auth/header mismatch
- Prefer documented/public app APIs exposed by the running launcher.
- Do not execute the app's internal Python/Node/bundled CLI as a fallback when `pterm` has already selected a launcher-managed app.
- If no automatable API exists after the app is running, report that clearly instead of bypassing the launcher with an internal CLI.

## Behavior Rules

- Do not add app-specific hardcoding when user gave only capability (for example "tts").
- Do not guess hidden endpoints when docs/code are unclear; ask one targeted question.
- Do not rewrite launcher files unless user explicitly asked.
- When a task needs a local executable such as `python`, prefer resolving it with `pterm which <command>` before falling back to generic shell discovery.
- Prefer returning full logs over brittle deterministic error parsing.
- REST endpoints may be used for diagnostics only when pterm is unavailable; do not claim full install/launch lifecycle completion without compatible pterm commands.
- Do not keep searching after app selection; move to status/run.
- Do not assume `external_ready_urls` exists; localhost-only apps are normal.
- Do not conflate loopback access failure, sandbox denial, or missing permission with "Pinokio is not running" or "`pterm` is not installed."
- On `pterm` permission failure, prefer asking for permission over asking the user to manually run commands.
- If `pterm` exists locally but cannot reach the control plane, explicitly tell the user this looks like a client permission/sandbox issue.

## Example

User: "Launch FaceFusion"

1. Use Search App and then Run App as usual.
2. If launcher menu has no explicit default item, infer ordered selectors from the current launcher menu.
3. Run:
   `pterm run <app_path> --default 'run.js?mode=Default' --default run.js --default install.js`
4. Poll `pterm status <app_id>` until ready.
