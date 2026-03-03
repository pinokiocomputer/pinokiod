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

1. Resolve `pterm` via `GET http://127.0.0.1:42000/pinokio/path/pterm`.
2. Read `path` from the response.
3. Use that absolute binary path for all `pterm` commands in this skill.
4. If lookup fails, report `pterm` unavailable and stop.

Use direct `pterm` commands for control-plane operations:

1. `pterm search "<query>"`
2. `pterm status <app_id>`
3. `pterm run <app_path>`
4. `pterm logs <app_id> --tail 200`
5. `pterm stars` (optional: inspect user-pinned favorites)
6. `pterm star <app_id>` / `pterm unstar <app_id>` (only when user explicitly asks to change preference)

Do not run install/update commands from this skill.

Permission handling:
- If a `pterm` command fails with loopback permission errors (`EPERM`/`EACCES` to `127.0.0.1:42000`), rerun the same command with required escalation/approval.
- Continue normal flow if rerun succeeds.
- Fail only if escalation is denied or rerun still cannot reach Pinokio.

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
     - exact `app_id`/title match (for explicit app requests)
     - `starred=true` (user preference)
     - `ready=true`
     - higher `matched_terms_count` (if available)
     - higher `launch_count_total` (if available)
     - more recent `last_launch_at` (if available)
     - higher `score`
     - `running=true`
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
   - Continue polling with `pterm status <app_id>`.
   - Default startup timeout: 180s.
   - Do not keep searching indefinitely once an app is selected; start it.

4. Success criteria.
   - `state=online` and `ready=true`.
   - If `ready_url` exists, use it as API base URL.

5. Failure criteria.
   - Timeout before success.
   - App drops back to `offline` during startup after a run attempt.
   - `pterm run` terminates and status never reaches ready.
   - On failure, fetch `pterm logs <app_id> --tail 200` and return:
     - raw log tail
     - short diagnosis

6. API call strategy (generated once, reused).
   - Cache location:
     - `~/pinokio/agents/clients/<app_id>/<operation>.<ext>`
   - First run for `<app_id>/<operation>`:
     - inspect docs/code to infer endpoint + payload
     - generate minimal HTTP client file (`js`/`py`/`sh`)
   - Later runs:
     - reuse existing generated client file directly
   - Regenerate only if request indicates contract mismatch:
     - 404/405 endpoint mismatch
     - 400/422 payload/schema mismatch
     - auth/header mismatch

## Behavior Rules

- Do not add app-specific hardcoding when user gave only capability (for example "tts").
- Do not guess hidden endpoints when docs/code are unclear; ask one targeted question.
- Do not rewrite launcher files unless user explicitly asked.
- Prefer returning full logs over brittle deterministic error parsing.
- REST endpoints may be used for diagnostics only when pterm is unavailable; do not claim full install/launch lifecycle completion without compatible pterm commands.
- Do not keep searching after app selection; move to status/run.

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
