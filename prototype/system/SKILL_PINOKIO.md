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

`pterm search`, `pterm status`, `pterm run`, `pterm open`, `pterm logs`, `pterm upload`, `pterm which`, `pterm stars`, `pterm star` / `pterm unstar`, `pterm registry search`, `pterm download`

Do not run update commands from this skill.
Once a Pinokio-managed app is selected, treat `pterm` and the launcher-managed interfaces as the source of truth for lifecycle and execution. Do not switch to repo-local CLIs or bundled app binaries unless the user explicitly asks for CLI mode.

## How to use

Follow these sections in order:
1. Use Search App first.
2. Only use Registry Fallback if Search App found no suitable installed app and the user approved it.
3. Then use Launch App.
4. Then use Using Apps if the app exposes an automatable API.
5. Only use Parallel Mode when the user explicitly asks to use multiple apps or multiple machines in parallel.

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
- If a suitable installed app is found, select it and continue to Launch App.
- Search results may include apps from other reachable Pinokio machines:
  - prefer the canonical `ref` field when it exists
  - `ref` uses the form `pinokio://<host>:<port>/<scope>/<id>`
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

### 3. Launch App

- Once you have a selected app, use `pterm status`.
- Poll every 2s.
- Use status fields from pterm output:
  - `path`: absolute app path to use with `pterm run`
  - `ref`: canonical Pinokio resource reference in the form `pinokio://<host>:<port>/<scope>/<id>`
  - `running`: script is running
  - `ready`: app is reachable/ready
  - `ready_url`: default base URL for API calls when available
  - `external_ready_urls`: optional ordered non-loopback app URLs for caller-side access; use them only when `ready_url` is missing or unusable due to loopback restrictions
  - `state`: `offline | starting | online`
  - `source`: machine identity for results from other reachable Pinokio machines
- Use `--probe` only for readiness confirmation before first API call (or when status is uncertain).
- Use `--timeout=<ms>` only when you need a non-default probe timeout.
- Treat `offline` as expected before first run.
- If `ref` points to another machine or `source.local=false`, the app is remote:
  - treat `path` and `ready_url` as source-local fields, not caller-usable local paths/URLs
  - use `external_ready_urls` in order for caller-side API access when available
  - use `pterm run <ref>` for remote launch; do not use a remote machine's `path` value as a local path
  - for remote path-based tasks:
    - this applies only when the task expects filesystem paths such as `/path/to/file`
    - do not pass local paths from this machine to the remote app
    - first run `pterm upload <ref> <file...>`
    - then use the returned remote `path` values
- If app is offline or not ready, run it:
  - If `ref` exists, run `pterm run <ref>`.
  - Otherwise run `pterm run <app_path>`.
  - If the launcher has no explicit default item or the launch action depends on current menu state, infer one or more ordered selectors from the launcher's current menu and pass them via repeated `--default`.
  - Prefer stable launcher selectors such as `run.js?mode=Default`, then broader fallbacks like `run.js`, then installation fallback like `install.js`.
  - Continue polling with `pterm status <ref>` when `ref` exists, otherwise `pterm status <app_id>`.
  - Default startup timeout: 180s.
- Success criteria:
  - `state=online` and `ready=true`
  - use `ready_url` by default when it exists and is caller-usable
  - if `ready_url` is missing, or it fails because the client cannot access loopback, and `external_ready_urls` exists, try those URLs in order
  - missing `external_ready_urls` is normal; it usually means network sharing is off
- If the user explicitly wants to open the app UI or open a web page in a browser or popup window:
  - use `pterm open`
  - only do this for explicit viewing/manual interaction requests, not for normal API automation
  - syntax:
    - `pterm open <url>`
    - `pterm open <url> --peer <peer>`
    - `pterm open <url> --surface browser`
    - `pterm open <url> --preset center-small|center-medium|center-large|fullscreen`
    - `pterm open <url> --peer <peer> --surface browser`
  - choose the URL based on where the window should open:
    - if the window should open on the current machine where `pterm` is running, use a caller-usable app URL:
      - `ready_url` when it exists and the current machine can reach it
      - otherwise the first usable entry from `external_ready_urls`
    - if the window should open on a remote peer node, add `--peer <peer>` and use the app's source-local URL on that peer:
      - prefer `ready_url` from that peer's point of view
      - if needed, use the source-local URL in `local_entries[].local.url`
  - do not invent raw `http://<peer_host>:<internal_port>` URLs from port numbers or local entries
  - default behavior should be popup-preferred:
    - on a desktop Pinokio node, it opens a Pinokio popup window
    - on a server-only or minimal node, it falls back to the system browser automatically
  - use `--surface browser` only when the user explicitly wants the system browser instead of the default popup-preferred behavior
  - popup size presets:
    - `center-small`
    - `center-medium`
    - `center-large`
    - `fullscreen`
  - if popup sizing matters and the user does not specify one, default to `--preset center-medium`
  - examples:
    - open on the current machine with the default popup-preferred behavior:
      - `pterm open http://192.168.86.26:42011`
    - open on the current machine in the system browser:
      - `pterm open http://192.168.86.26:42011 --surface browser`
    - open on peer `192.168.86.26` using that peer's local app URL:
      - `pterm open http://127.0.0.1:7860 --peer 192.168.86.26`
    - open on peer `192.168.86.26` in that peer's system browser:
      - `pterm open http://127.0.0.1:7860 --peer 192.168.86.26 --surface browser`
    - open on peer `192.168.86.26` as a large popup:
      - `pterm open http://127.0.0.1:7860 --peer 192.168.86.26 --preset center-large`
- Failure criteria:
  - timeout before success
  - app drops back to `offline` during startup after a run attempt
  - `pterm run` terminates and status never reaches ready
  - on failure, fetch `pterm logs <ref> --tail 200` when `ref` exists, otherwise `pterm logs <app_id> --tail 200`, and return:
    - raw log tail
    - short diagnosis
- After successful task completion:
  - do not stop or shut down the app unless the user explicitly asks
  - prefer leaving a successfully running app online for reuse

### 4. Using Apps
- Create or reuse one app-specific skill folder for the selected app:
  - `<current_working_directory>/pinokio_agent/skills/<scope>/<app_id>/`
- App-specific skill folder structure:
  - `SKILL.md`: persistent, shareable across machines, not tied to a specific host, filesystem, or path, app-specific delta relative to the workspace/root Pinokio instructions
    - include frontmatter with only:
      - `name`: short stable app-specific skill name using lowercase letters, digits, and hyphens only; derive it from a normalized app identity such as `<scope>-<app_id>` and keep it under 64 characters
      - `description`: one clear sentence describing what this app-specific skill does and when it should be used
  - optional `clients/`: reusable local client files
  - optional `references/`: saved API artifacts such as OpenAPI specs, Gradio config, or concise notes
  - outputs: `<app_skill_folder>/output/<target_host>/...`

- Saved app-specific `SKILL.md` policy:
  - treat it as a persistent, shareable delta relative to the workspace/root Pinokio instructions
  - it must contain only durable app-specific API/client usage details not already covered by the workspace/root Pinokio instructions
  - it must not repeat generic Pinokio search, launch, readiness, polling, `pterm` resolution, permission, upload, or base URL selection rules
  - it must not contain session-local or machine-local values, including:
    - absolute filesystem paths
    - resolved `pterm` binary paths
    - concrete `pinokio://<host>:<port>/...` refs
    - concrete `ready_url` / `external_ready_urls`
    - concrete localhost / `127.0.0.1` URLs or ports
    - uploaded temp paths
    - session-specific discovered IDs such as profile IDs
    - auth tokens, cookies, or headers
    - app-internal `env/bin/python` paths or bundled CLI paths
  - it must not copy the exact successful shell command from the current session unless all machine-local values have been replaced with generic runtime discovery steps or placeholders
  - if there is no durable app-specific delta worth saving, do not create or expand `SKILL.md` just to restate generic Pinokio behavior
  - if a saved app-specific `SKILL.md` violates this policy, treat it as stale and rewrite it before reuse

- Canonical `SKILL.md` body shape:
  - `# <App> API`
  - optional `## Clients`
  - `## Operations`
  - `## Runtime Inputs`
  - `## Outputs`
  - `## Notes`
  - omit empty sections
  - do not add sections such as `Launch command`, `Poll status`, or `Base URL` unless the app has a genuine app-specific exception that is not already covered by the workspace/root Pinokio instructions

- Reuse an existing app-specific skill when possible:
  - if `<app_skill_folder>/SKILL.md` exists and still describes the app's current API correctly and still follows this policy, read it first and follow it
  - if the folder already contains a reusable client for the needed operation and it still works against the current app API and does not hardcode per-run values, reuse that client
  - if the folder has no `SKILL.md`, or the saved instructions or saved client no longer match the current API or this policy, rediscover the app interface and rewrite the app-specific skill folder

- If rediscovery is needed, choose exactly one usage mode:
  - Mode A: use the app directly
  - Mode B: reuse or generate a reusable client
- Use Mode A only if all of these are true:
  - the running app already exposes a documented HTTP API you can call directly
  - the task is simple enough to complete with one or a few direct requests
  - saving a client file would not make later work meaningfully easier
- Standard callable API examples:
  - OpenAPI / Swagger endpoints
  - FastAPI docs
  - Gradio API
  - other documented standard HTTP interfaces
- Otherwise use Mode B.

- Shared rules for both modes:
  - prefer documented/public APIs exposed by the running launcher
  - at runtime, choose a base URL that the current machine can actually reach:
    - use `ready_url` when it exists and the current machine can reach it
    - otherwise use `external_ready_urls` in order
  - if the task needs remote filesystem paths, first run `pterm upload <ref> <file...>` and use the returned remote paths for that target only
  - never reuse a remote uploaded path from one target on another target
  - put bulky raw artifacts in `references/` instead of bloating `SKILL.md`

- Mode A: use the app directly
  - execute the needed requests directly from the current machine
  - update `<app_skill_folder>/SKILL.md` only to record:
    - app-specific operations/endpoints
    - app-specific required runtime inputs and outputs in generic form
    - app-specific non-secret caveats
    - app-specific routing or API-surface exceptions not already covered by the workspace/root Pinokio instructions
    - whether remote upload is needed for path-based tasks when that requirement is specific to this app's contract
  - do not create a reusable client in this mode unless the workflow later becomes repetitive or multi-step enough to justify Mode B

- Mode B: reuse or generate a reusable client
  - if no matching client exists under `<app_skill_folder>/clients/` for the needed operation, generate one
  - if a client exists but the contract no longer matches, regenerate it only for:
    - 404/405 endpoint mismatch
    - 400/422 payload/schema mismatch
    - auth/header mismatch
  - inspect docs/code to infer endpoint + payload
  - generate a minimal cross-platform HTTP client in `py` or `js`
  - do not use Bash, PowerShell, or other machine-specific shell scripts for reusable clients unless the user explicitly asks for a machine-local one-off script
  - generated clients run on the current machine; do not copy or write them onto the remote machine
  - organize clients by app and operation, not by host
    - example: if local Cropper and remote Cropper use the same endpoint and payload shape for `trim`, reuse one client such as `clients/trim.py`
  - do not create a second client file only because the target host changed
  - pass per-run values into the client at execution time:
    - a base URL that the current machine can actually reach
    - uploaded remote file paths when needed
    - per-run auth headers/cookies if required
  - never hardcode per-run values into the saved client:
    - `ref`
    - base URL / host / port
    - uploaded temp file paths
    - per-run auth tokens or cookies
  - update `<app_skill_folder>/SKILL.md` only to record:
    - which client file to use for each operation
    - required runtime arguments in generic form
    - expected outputs
    - when the client should be regenerated

- Do not execute the app's internal Python/Node/bundled CLI as a fallback when `pterm` has already selected a launcher-managed app.
- If no automatable API exists after the app is running, report that clearly instead of bypassing the launcher with an internal CLI.

### 5. Parallel Mode (explicit only)

- Use this section only when the user explicitly asks to:
  - run on multiple machines
  - use multiple apps in parallel
  - compare multiple relevant apps side by side
  - generate multiple outputs concurrently
- Do not use this mode by default.
- Keep each selected app as a separate target. Prefer `ref` as the target identifier when it exists.
- Selection rules:
  - if the user asks for all relevant apps, use all relevant search results that can perform the task
  - if the user asks for a specific count, use the top N relevant search results after normal search ranking
  - if the user asks for parallel use but does not specify how many apps or machines to use, ask once
- Ranking still applies in this mode:
  - prefer `ready` apps first
  - then `running` apps
  - then offline apps if more targets are still needed
- Run and monitor each selected target independently.
- Keep outputs labeled by target `ref` when it exists, otherwise `app_id`.
- For remote path-based tasks, run `pterm upload <ref> <file...>` separately for each remote target when `ref` exists, otherwise fall back to `app_id`.
- Do not reuse one target's uploaded remote file path for another target.

## Behavior Rules

- Do not add app-specific hardcoding when user gave only capability (for example "tts").
- Do not guess hidden endpoints when docs/code are unclear; ask one targeted question.
- Do not rewrite launcher files unless user explicitly asked.
- When a task needs a local executable such as `python`, prefer resolving it with `pterm which <command>` before falling back to generic shell discovery.
- Prefer returning full logs over brittle deterministic error parsing.
- Pinokio control-plane REST endpoints may be used for diagnostics only when `pterm` is unavailable; do not claim full install/launch lifecycle completion without compatible `pterm` commands.
- Do not keep searching after app selection; move to Launch App.
- Do not assume `external_ready_urls` exists; localhost-only apps are normal.
- Do not conflate loopback access failure, sandbox denial, or missing permission with "Pinokio is not running" or "`pterm` is not installed."
- On `pterm` permission failure, prefer asking for permission over asking the user to manually run commands.
- If `pterm` exists locally but cannot reach the control plane, explicitly tell the user this looks like a client permission/sandbox issue.

## Example

User: "Launch FaceFusion"

1. Use Search App and then Launch App as usual.
2. If launcher menu has no explicit default item, infer ordered selectors from the current launcher menu.
3. Run:
   - if `ref` exists:
     `pterm run <ref> --default 'run.js?mode=Default' --default run.js --default install.js`
   - otherwise:
     `pterm run <app_path> --default 'run.js?mode=Default' --default run.js --default install.js`
4. Poll:
   - `pterm status <ref>` when `ref` exists
   - otherwise `pterm status <app_id>`
   until ready.
