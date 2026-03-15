---
name: pinokio
description: Use pterm to discover apps, ensure they are running, and execute API requests with generated-once reusable clients.
---

# Pinokio Runtime Skill (pterm-first)

Use this skill for runtime control of Pinokio apps.
Do not ask users to manually install, launch, or call APIs when `pterm` can do it.

## Control Plane

Assume `pterm` is preinstalled and up to date.

### pterm Resolution (External Clients)

If running outside Pinokio's own shell, do not assume `pterm` is on `PATH`.

1. If the client can execute shell commands, first check whether `pterm` already works by name in the current shell.
2. If `pterm` works by name, use that command form for all `pterm` commands in this skill.
3. If `pterm` does not work by name or shell command execution is unavailable, resolve `pterm` via `GET http://127.0.0.1:42000/pinokio/path/pterm`.
4. Read `path` from the response.
5. Normalize the resolved path for the current platform and shell before executing it.
   - On Windows, if the resolved path has no executable Windows extension, prefer a sibling shim such as `.cmd` or `.ps1` when present.
6. Use the working command/path form consistently for all `pterm` commands in this skill.
7. If lookup fails, do not immediately conclude that Pinokio is not running.
8. Distinguish failure modes before stopping:
   - `EPERM` / `EACCES` / sandbox denial to `127.0.0.1:42000`:
     - treat this as a local permission problem, not a missing runtime
     - ask for permission first if the client supports permission prompts, escalation, or tool approval
     - rerun the same probe after permission is granted
     - if permission prompts are unavailable, report that loopback access is blocked by the client/sandbox
   - timeout / connection refused / DNS failure:
     - report that the control plane is unreachable rather than claiming `pterm` is uninstalled
   - HTTP success with missing/empty `path`:
     - continue with fallback path checks below before concluding `pterm` is unavailable
9. If the control-plane probe is blocked or returns an empty path, check common local `pterm` locations:
   - `which pterm` or `where pterm`
10. If a local `pterm` binary exists, normalize it for the current shell/platform, use it, and continue. If later `pterm` commands fail against `127.0.0.1:42000` with permission errors, report a loopback permission issue explicitly.
11. Only report "`pterm` unavailable" when both the command-form probe and the resolved/fallback path checks fail.

Use direct `pterm` commands for control-plane operations:

1. `pterm search "<query>"`
2. `pterm status <app_id>`
3. `pterm run <app_path> [--default <selector>]...`
4. `pterm logs <app_id> --tail 200`
5. `pterm stars` (optional: inspect user-pinned favorites)
6. `pterm star <app_id>` / `pterm unstar <app_id>` (only when user explicitly asks to change preference)

Do not run install/update commands from this skill.
Do not execute bundled app binaries or internal app CLIs from the app repo unless the user explicitly asks for CLI mode.
Once a Pinokio-managed app is selected, treat the launcher and its exposed interfaces as the source of truth for lifecycle and execution.
Do not switch to alternate repo-local execution paths unless the user explicitly requests that mode.

Permission handling:
- If a probe or `pterm` command fails with loopback permission errors (`EPERM`/`EACCES` to `127.0.0.1:42000`), ask for permission first when the client supports permission prompts or escalation.
- After permission is granted, rerun the same command.
- Continue normal flow if rerun succeeds.
- Fail only if permission/escalation is denied, unavailable, or rerun still cannot reach Pinokio.
- When failing after those retries, say "Pinokio may be running, but this client cannot reach the local control plane" rather than "Pinokio is not installed/running" unless you have confirmed both conditions.

## Workflow

1. Resolve app target.
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
     - Within the selected runtime tier, rank by user preference:
       - exact `app_id`/title match (for explicit app requests)
       - `starred=true`
     - Within that same tier, use the remaining tiebreakers:
       - higher `matched_terms_count` (if available)
       - higher `launch_count_total` (if available)
       - more recent `last_launch_at` (if available)
       - higher `score`
     - Do not choose an offline app over a relevant `ready` or `running` app.
     - Do not choose a non-starred app over a relevant starred app in the same runtime tier unless the starred app is clearly not a useful match.
   - If the top candidate is not clearly better than alternatives, ask user once with top 3 candidates.

2. Check runtime state with `pterm status`.
   - Poll every 2s.
   - Use status fields from pterm output:
     - `path`: absolute app path to use with `pterm run`
     - `running`: script is running
     - `ready`: app is reachable/ready
     - `ready_url`: base URL for API calls when available
     - `state`: `offline | starting | online`
   - Use `--probe` only for readiness confirmation before first API call (or when status is uncertain).
   - Use `--timeout=<ms>` only when you need a non-default probe timeout.
   - Treat `offline` as expected before first run.

3. If app is offline or not ready, run it.
   - Run `pterm run <app_path>`.
   - If the launcher has no explicit default item or the launch action depends on current menu state, infer one or more ordered selectors from the launcher's current menu and pass them via repeated `--default`.
   - Prefer stable launcher selectors such as `run.js?mode=Default`, then broader fallbacks like `run.js`, then installation fallback like `install.js`.
   - Continue polling with `pterm status <app_id>`.
   - Default startup timeout: 180s.
   - Do not keep searching indefinitely once an app is selected; start it.

4. Success criteria.
   - `state=online` and `ready=true`.
   - If `ready_url` exists, use it as API base URL.
   - Treat `ready_url` plus a generated or reused client as the default execution path for app functionality.

5. Failure criteria.
   - Timeout before success.
   - App drops back to `offline` during startup after a run attempt.
   - `pterm run` terminates and status never reaches ready.
   - On failure, fetch `pterm logs <app_id> --tail 200` and return:
     - raw log tail
     - short diagnosis

6. API call strategy (generated once, reused).
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
- Prefer returning full logs over brittle deterministic error parsing.
- REST endpoints may be used for diagnostics only when pterm is unavailable; do not claim full install/launch lifecycle completion without compatible pterm commands.
- Do not keep searching after app selection; move to status/run.
- Do not conflate loopback access failure, sandbox denial, or missing permission with "Pinokio is not running" or "`pterm` is not installed."
- On localhost permission failure, prefer asking for permission over asking the user to manually run commands.
- If `127.0.0.1:42000` is blocked but local `pterm` exists, explicitly tell the user this looks like a client permission/sandbox issue.
- After app selection, do not execute `python`, `node`, shell entrypoints, or repo-local binaries inside the selected app unless the user explicitly asks for CLI mode.
- Do not inspect bundled CLI help or probe repo-local executables as an alternative execution path when the task is to operate the Pinokio-managed app.
- "Launch the app server and run it" means `pterm status` -> `pterm run` -> wait for `ready=true` -> use `ready_url` with a generated/reused client.
- If `ready_url` is absent, use `pterm` only for lifecycle control and ask one targeted question or report that the app lacks a clear automatable API. Do not silently fall back to internal CLI execution.

## Example A (Capability Only)

User: "Generate TTS from this text: hello world"

1. `pterm search "tts speech synthesis" --mode balanced --min-match 2 --limit 8`
2. Pick best match using deterministic ranking (or ask once if ambiguous).
3. `pterm status <app_id>`
4. If not ready: `pterm run <app_path>`, keep polling status.
5. Before first API call: `pterm status <app_id> --probe`
6. When ready: generate/reuse `text_to_speech` client and execute.
7. Return output (audio path/bytes) or failure with `pterm logs`.

## Example B (Explicit App)

User: "Use Qwen-TTS to generate speech from this text: hello world"

1. `pterm search "qwen tts" --mode balanced --min-match 1 --limit 8`.
2. If exact app_id/title match exists, pick it.
3. `pterm status <app_id>`
4. Before first API call: `pterm status <app_id> --probe`
5. If not ready: `pterm run <app_path>`, keep polling.
6. When ready: generate/reuse `text_to_speech` client and execute.
7. Return output or failure with `pterm logs`.

## Example C (No Launcher Default)

User: "Launch FaceFusion"

1. Resolve app target and status as usual.
2. If launcher menu has no explicit default item, infer ordered selectors from the current launcher menu.
3. Run:
   `pterm run <app_path> --default 'run.js?mode=Default' --default run.js --default install.js`
4. Poll `pterm status <app_id>` until ready.
