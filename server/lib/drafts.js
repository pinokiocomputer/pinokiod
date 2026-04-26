const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ParcelWatcher = require("@parcel/watcher");

const RESULT_RELATIVE_DIR = path.join(".pinokio", "draft");
const POST_FILENAME = "post.md";
const READY_FILENAME = "READY";
const STATE_FILENAME = "drafts.json";
const MAX_PREVIEW_BYTES = 256 * 1024;
const PREVIEW_CHARS = 1200;
const MEDIA_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mp3",
  ".mp4",
  ".ogg",
  ".png",
  ".svg",
  ".wav",
  ".webm",
  ".webp"
]);

function createHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractTitle(markdown, workspaceName) {
  const lines = String(markdown || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (match && match[1]) {
      return normalizeWhitespace(match[1]).slice(0, 140) || "Draft";
    }
  }
  return workspaceName ? `Draft for ${workspaceName}` : "Draft";
}

function buildExcerpt(markdown) {
  const stripped = String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, (match) => {
      const label = match.match(/^\[([^\]]+)]/);
      return label && label[1] ? ` ${label[1]} ` : " ";
    })
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>#-]/g, " ");
  return normalizeWhitespace(stripped).slice(0, PREVIEW_CHARS);
}

function isExternalRef(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function normalizeMarkdownRef(value) {
  const raw = String(value || "").trim().replace(/^<|>$/g, "");
  if (!raw || raw.includes("\0") || isExternalRef(raw) || path.isAbsolute(raw)) {
    return "";
  }
  const withoutHash = raw.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  if (!withoutQuery) {
    return "";
  }
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch (_) {
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return "";
  }
  return normalized;
}

function collectMarkdownRefs(markdown) {
  const refs = [];
  const seen = new Set();
  const patterns = [
    /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    /\[(?:video|audio|media|image|screenshot|file|asset)[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gi,
    /\[[^\]]+]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  ];
  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(markdown))) {
      const ref = normalizeMarkdownRef(match[1]);
      if (!ref || seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

async function describeMediaRefs(markdown, baseDir) {
  const refs = collectMarkdownRefs(markdown);
  const media = [];
  for (const ref of refs) {
    const ext = path.extname(ref).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) {
      continue;
    }
    const filePath = path.resolve(baseDir, ref);
    const relative = path.relative(baseDir, filePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      continue;
    }
    const stats = await fs.promises.stat(filePath).catch(() => null);
    media.push({
      ref,
      path: filePath,
      bytes: stats && stats.isFile() ? stats.size : null,
      exists: Boolean(stats && stats.isFile())
    });
  }
  return media;
}

function isRelevantEvent(workspacePath, eventPath) {
  const relative = path.relative(workspacePath, eventPath || "");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const normalized = relative.split(path.sep).join("/");
  return normalized === ".pinokio/draft"
    || normalized.startsWith(".pinokio/draft/");
}

function createDraftService({ kernel, taskWorkspaceLinks }) {
  if (!kernel) {
    throw new Error("kernel is required");
  }
  if (!taskWorkspaceLinks) {
    throw new Error("taskWorkspaceLinks is required");
  }

  const statePath = () => path.resolve(kernel.path("tasks"), STATE_FILENAME);
  const resultsByWorkspace = new Map();
  const watchersByWorkspace = new Map();
  const dismissedIds = new Set();
  let started = false;
  let stateLoaded = false;

  async function ensureStateLoaded() {
    if (stateLoaded) {
      return;
    }
    stateLoaded = true;
    try {
      const raw = await fs.promises.readFile(statePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.dismissed)) {
        parsed.dismissed.forEach((id) => {
          if (typeof id === "string" && id.trim()) {
            dismissedIds.add(id.trim());
          }
        });
      }
    } catch (_) {
    }
  }

  async function saveState() {
    await fs.promises.mkdir(path.dirname(statePath()), { recursive: true });
    const payload = {
      version: 1,
      dismissed: Array.from(dismissedIds).slice(-500)
    };
    await fs.promises.writeFile(statePath(), JSON.stringify(payload, null, 2));
  }

  async function readMarkdownPreview(postPath) {
    const handle = await fs.promises.open(postPath, "r");
    try {
      const buffer = Buffer.alloc(MAX_PREVIEW_BYTES);
      const read = await handle.read(buffer, 0, MAX_PREVIEW_BYTES, 0);
      return buffer.slice(0, read.bytesRead).toString("utf8");
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async function inspectWorkspace({ taskId, ref, cwd }) {
    if (typeof cwd !== "string" || !cwd.trim()) {
      return null;
    }
    const workspacePath = path.resolve(cwd.trim());
    const resultDir = path.join(workspacePath, RESULT_RELATIVE_DIR);
    const readyPath = path.join(resultDir, READY_FILENAME);
    const postPath = path.join(resultDir, POST_FILENAME);
    const readyStats = await fs.promises.stat(readyPath).catch(() => null);
    const postStats = await fs.promises.stat(postPath).catch(() => null);
    if (!readyStats || !readyStats.isFile() || !postStats || !postStats.isFile()) {
      resultsByWorkspace.delete(workspacePath);
      return null;
    }

    const markdown = await readMarkdownPreview(postPath);
    const workspaceName = path.basename(workspacePath);
    const media = await describeMediaRefs(markdown, resultDir);
    const updatedAtMs = Math.max(readyStats.mtimeMs || 0, postStats.mtimeMs || 0);
    const id = createHash(`${workspacePath}|${postStats.size}|${postStats.mtimeMs}|${readyStats.mtimeMs}`);
    const result = {
      id,
      taskId,
      ref,
      cwd: workspacePath,
      workspaceName,
      title: extractTitle(markdown, workspaceName),
      excerpt: buildExcerpt(markdown),
      postPath,
      readyPath,
      postBytes: postStats.size,
      mediaCount: media.length,
      missingMediaCount: media.filter((item) => !item.exists).length,
      mediaBytes: media.reduce((total, item) => total + (Number.isFinite(item.bytes) ? item.bytes : 0), 0),
      updatedAt: new Date(updatedAtMs || Date.now()).toISOString()
    };
    resultsByWorkspace.set(workspacePath, result);
    return result;
  }

  function scheduleInspect(taskId, ref, cwd) {
    setTimeout(() => {
      inspectWorkspace({ taskId, ref, cwd }).catch((error) => {
        console.warn("[drafts] failed to inspect workspace", error && error.message ? error.message : error);
      });
    }, 250);
  }

  async function ensureWatcher(taskId, ref, cwd) {
    if (typeof cwd !== "string" || !cwd.trim()) {
      return;
    }
    const workspacePath = path.resolve(cwd.trim());
    if (watchersByWorkspace.has(workspacePath)) {
      return;
    }
    const stats = await fs.promises.stat(workspacePath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
      return;
    }
    try {
      const subscription = await ParcelWatcher.subscribe(
        workspacePath,
        (error, events) => {
          if (error) {
            console.warn("[drafts] watcher error", error && error.message ? error.message : error);
            return;
          }
          if (!Array.isArray(events) || !events.some((event) => isRelevantEvent(workspacePath, event && event.path))) {
            return;
          }
          scheduleInspect(taskId, ref, workspacePath);
        },
        {
          ignore: [
            "**/.git/**",
            "**/node_modules/**",
            "**/__pycache__/**",
            "**/.venv/**",
            "**/venv/**",
            "**/env/**"
          ]
        }
      );
      watchersByWorkspace.set(workspacePath, subscription);
    } catch (error) {
      console.warn("[drafts] failed to watch workspace", error && error.message ? error.message : error);
    }
  }

  async function refreshLinkedWorkspaces() {
    await ensureStateLoaded();
    const registry = await taskWorkspaceLinks.readRegistry();
    const seen = new Set();
    const tasks = registry && registry.tasks && typeof registry.tasks === "object" ? registry.tasks : {};
    for (const [taskId, entry] of Object.entries(tasks)) {
      const workspaces = entry && Array.isArray(entry.workspaces) ? entry.workspaces : [];
      for (const workspace of workspaces) {
        const ref = workspace && typeof workspace.ref === "string" ? workspace.ref : "";
        const cwd = taskWorkspaceLinks.resolveWorkspaceRef(ref);
        if (!cwd) {
          continue;
        }
        const workspacePath = path.resolve(cwd);
        seen.add(workspacePath);
        await ensureWatcher(taskId, ref, workspacePath);
        await inspectWorkspace({ taskId, ref, cwd: workspacePath });
      }
    }
    for (const workspacePath of Array.from(resultsByWorkspace.keys())) {
      if (!seen.has(workspacePath)) {
        resultsByWorkspace.delete(workspacePath);
      }
    }
  }

  async function start() {
    if (started) {
      return;
    }
    started = true;
    await refreshLinkedWorkspaces();
  }

  async function trackWorkspace({ taskId, ref }) {
    await ensureStateLoaded();
    const cwd = taskWorkspaceLinks.resolveWorkspaceRef(ref);
    if (!cwd) {
      return null;
    }
    await ensureWatcher(taskId, ref, cwd);
    return inspectWorkspace({ taskId, ref, cwd });
  }

  async function listPending(options = {}) {
    await refreshLinkedWorkspaces();
    const filterCwd = typeof options.cwd === "string" && options.cwd.trim()
      ? path.resolve(options.cwd.trim())
      : "";
    return Array.from(resultsByWorkspace.values())
      .filter((result) => !dismissedIds.has(result.id))
      .filter((result) => !filterCwd || result.cwd === filterCwd)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function dismiss(id) {
    await ensureStateLoaded();
    const normalizedId = typeof id === "string" ? id.trim() : "";
    if (!normalizedId) {
      return false;
    }
    dismissedIds.add(normalizedId);
    await saveState();
    return true;
  }

  async function stop() {
    for (const subscription of watchersByWorkspace.values()) {
      if (subscription && typeof subscription.unsubscribe === "function") {
        await subscription.unsubscribe().catch(() => {});
      }
    }
    watchersByWorkspace.clear();
  }

  return {
    RESULT_RELATIVE_DIR,
    dismiss,
    inspectWorkspace,
    listPending,
    refreshLinkedWorkspaces,
    start,
    stop,
    trackWorkspace
  };
}

module.exports = {
  createDraftService
};
