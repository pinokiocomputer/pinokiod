const fs = require("fs");
const path = require("path");
const git = require("isomorphic-git");

const TASK_INDEX_VERSION = 1;
const TASK_INDEX_FILENAME = "index.json";
const TASK_CONFIG_FILENAME = "pinokio.json";
const TASK_TEMPLATE_FILENAME = "task.md";
const TASK_ID_PATTERN = /^t[1-9][0-9]*$/;
const TASK_INPUT_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function slugify(value, fallback = "task") {
  const normalized = typeof value === "string" ? value : "";
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\-\s_]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug || fallback;
}

function normalizeTaskId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!TASK_ID_PATTERN.test(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeTaskRef(kernel, value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  if (kernel && kernel.git && typeof kernel.git.canonicalRepoUrl === "function") {
    return kernel.git.canonicalRepoUrl(raw) || "";
  }
  return raw;
}

function extractTemplateVariableNames(template) {
  const regex = /{{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]*)\s*}}/g;
  const names = new Set();
  if (!template || typeof template !== "string") {
    return [];
  }
  let match;
  while ((match = regex.exec(template)) !== null) {
    names.add(match[1]);
  }
  return Array.from(names);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyTemplateValues(template, values) {
  let result = typeof template === "string" ? template : "";
  if (!values || typeof values !== "object") {
    return result;
  }
  Object.entries(values).forEach(([name, value]) => {
    const pattern = new RegExp(`{{\\s*${escapeRegExp(name)}\\s*}}`, "g");
    result = result.replace(pattern, value == null ? "" : String(value));
  });
  return result;
}

function extractInputValues(source) {
  const values = {};
  const inputSource = source && typeof source === "object" ? source : {};
  Object.entries(inputSource).forEach(([key, value]) => {
    if (!key.startsWith("input.")) {
      return;
    }
    const inputName = key.slice("input.".length).trim();
    if (!TASK_INPUT_NAME_PATTERN.test(inputName)) {
      return;
    }
    if (Array.isArray(value)) {
      values[inputName] = value.length > 0 ? String(value[0] || "") : "";
    } else if (value != null) {
      values[inputName] = String(value);
    } else {
      values[inputName] = "";
    }
  });
  return values;
}

function validateTaskConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    const error = new Error("pinokio.json must contain an object.");
    error.status = 400;
    error.validation = {
      type: "task",
      title: "Invalid Task",
      message: error.message,
      errors: [{
        message: error.message,
        fix: "Make sure pinokio.json exports a valid object."
      }]
    };
    throw error;
  }

  const title = typeof rawConfig.title === "string" ? rawConfig.title.trim() : "";
  if (!title) {
    const error = new Error("Task title is required.");
    error.status = 400;
    error.validation = {
      type: "task",
      title: "Invalid Task",
      message: error.message,
      errors: [{
        message: error.message,
        fix: "Add a non-empty title field to pinokio.json."
      }]
    };
    throw error;
  }

  const description = typeof rawConfig.description === "string" ? rawConfig.description.trim() : "";
  const taskPath = typeof rawConfig.path === "string" ? rawConfig.path.trim() : "";
  if (!taskPath) {
    const error = new Error("Task path is required.");
    error.status = 400;
    error.validation = {
      type: "task",
      title: "Invalid Task",
      message: error.message,
      errors: [{
        message: error.message,
        fix: 'Add `path: "tasks"` to pinokio.json.'
      }]
    };
    throw error;
  }
  if (taskPath !== "tasks") {
    const error = new Error("Task path must be tasks.");
    error.status = 400;
    error.validation = {
      type: "task",
      title: "Invalid Task",
      message: error.message,
      errors: [{
        message: error.message,
        fix: 'Change the task path to `tasks`.'
      }]
    };
    throw error;
  }
  if (taskPath.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(taskPath)) {
    const error = new Error("Task path is invalid.");
    error.status = 400;
    error.validation = {
      type: "task",
      title: "Invalid Task",
      message: error.message,
      errors: [{
        message: error.message,
        fix: 'Use `path: "tasks"` without additional path traversal.'
      }]
    };
    throw error;
  }

  const taskTargetRaw = typeof rawConfig.target === "string" ? rawConfig.target.trim() : "";
  const taskTarget = taskTargetRaw || "workspaces";
  if (!["workspaces", "api", "plugin"].includes(taskTarget)) {
    const error = new Error("Task target is invalid.");
    error.status = 400;
    error.validation = {
      type: "task",
      title: "Invalid Task",
      message: error.message,
      errors: [{
        message: error.message,
        fix: 'Set target to one of: "workspaces", "api", or "plugin".'
      }]
    };
    throw error;
  }

  const rawInputs = Array.isArray(rawConfig.inputs) ? rawConfig.inputs : [];
  const normalizedInputs = [];
  const seenNames = new Set();
  rawInputs.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!TASK_INPUT_NAME_PATTERN.test(name) || seenNames.has(name)) {
      return;
    }
    seenNames.add(name);
    const label = typeof entry.label === "string" && entry.label.trim()
      ? entry.label.trim()
      : name.replace(/[_\-.]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    normalizedInputs.push({
      name,
      label,
      required: entry.required !== false
    });
  });

  return {
    title,
    description,
    path: taskPath,
    target: taskTarget,
    inputs: normalizedInputs
  };
}

function buildTaskInputs(config, template) {
  const map = new Map();
  const baseInputs = config && Array.isArray(config.inputs) ? config.inputs : [];
  baseInputs.forEach((entry) => {
    if (!entry || !entry.name) {
      return;
    }
    map.set(entry.name, {
      name: entry.name,
      label: entry.label || entry.name,
      required: entry.required !== false
    });
  });
  extractTemplateVariableNames(template).forEach((name) => {
    if (map.has(name)) {
      return;
    }
    map.set(name, {
      name,
      label: name.replace(/[_\-.]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      required: true
    });
  });
  return Array.from(map.values());
}

function buildTaskConfigForWrite(rawConfig, template) {
  const validatedConfig = validateTaskConfig(rawConfig);
  const templateNames = extractTemplateVariableNames(template);
  const templateNameSet = new Set(templateNames);
  const extraConfiguredInputs = validatedConfig.inputs
    .map((entry) => entry.name)
    .filter((name) => !templateNameSet.has(name));
  if (extraConfiguredInputs.length > 0) {
    const error = new Error(`Inputs not used in task.md: ${extraConfiguredInputs.join(", ")}`);
    error.status = 400;
    throw error;
  }
  return {
    ...validatedConfig,
    inputs: templateNames.map((name) => {
      const configured = validatedConfig.inputs.find((entry) => entry.name === name) || null;
      return {
        name,
        label: configured && configured.label
          ? configured.label
          : name.replace(/[_\-.]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        required: configured ? configured.required !== false : true
      };
    })
  };
}

function validateTaskSchema(config, template) {
  const declaredNames = Array.isArray(config && config.inputs)
    ? config.inputs.map((entry) => entry && entry.name).filter(Boolean)
    : [];
  const declaredSet = new Set(declaredNames);
  const templateNames = extractTemplateVariableNames(template);
  const templateSet = new Set(templateNames);
  const missing = templateNames.filter((name) => !declaredSet.has(name));
  const extra = declaredNames.filter((name) => !templateSet.has(name));

  if (missing.length === 0 && extra.length === 0) {
    return;
  }

  const parts = [];
  if (missing.length > 0) {
    parts.push(`missing inputs for: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    parts.push(`unused declared inputs: ${extra.join(", ")}`);
  }
  const error = new Error(`Task schema mismatch between pinokio.json and task.md (${parts.join("; ")}).`);
  error.status = 400;
  error.validation = {
    type: "task",
    title: "Invalid Task",
    message: error.message,
    errors: [{
      message: error.message,
      fix: "Make sure pinokio.json inputs exactly match the variables used in task.md."
    }]
  };
  throw error;
}

function createTaskPackageService({ kernel }) {
  if (!kernel) {
    throw new Error("kernel is required");
  }

  const tasksRoot = () => path.resolve(kernel.path("tasks"));
  const taskIndexPath = () => path.resolve(tasksRoot(), TASK_INDEX_FILENAME);
  const taskDirForId = (id) => path.resolve(tasksRoot(), id);

  async function ensureTasksRoot() {
    await fs.promises.mkdir(tasksRoot(), { recursive: true });
  }

  function normalizeTaskIndex(rawIndex) {
    const nextId = Number.parseInt(rawIndex && rawIndex.nextId, 10);
    const normalizedItems = Array.isArray(rawIndex && rawIndex.items) ? rawIndex.items : [];
    const items = normalizedItems
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const id = normalizeTaskId(entry.id);
        if (!id) {
          return null;
        }
        const normalizedRef = normalizeTaskRef(kernel, entry.ref);
        return normalizedRef ? { id, ref: normalizedRef } : { id };
      })
      .filter(Boolean);
    return {
      version: TASK_INDEX_VERSION,
      nextId: Number.isFinite(nextId) && nextId > 0 ? nextId : 1,
      items
    };
  }

  async function readTaskIndex() {
    await ensureTasksRoot();
    const indexFile = taskIndexPath();
    try {
      const raw = await fs.promises.readFile(indexFile, "utf8");
      return normalizeTaskIndex(JSON.parse(raw));
    } catch (error) {
      const initial = {
        version: TASK_INDEX_VERSION,
        nextId: 1,
        items: []
      };
      await fs.promises.writeFile(indexFile, JSON.stringify(initial, null, 2));
      return initial;
    }
  }

  async function writeTaskIndex(index) {
    await ensureTasksRoot();
    const normalized = normalizeTaskIndex(index);
    await fs.promises.writeFile(taskIndexPath(), JSON.stringify(normalized, null, 2));
    return normalized;
  }

  async function allocateTaskId() {
    const index = await readTaskIndex();
    let nextValue = Number.isFinite(index.nextId) && index.nextId > 0 ? index.nextId : 1;
    let id = `t${nextValue}`;
    while (index.items.some((entry) => entry.id === id)) {
      nextValue += 1;
      id = `t${nextValue}`;
    }
    return {
      id,
      index,
      nextValue
    };
  }

  async function listTaskFilesForGit(dir, currentDir = dir, prefix = "") {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry || entry.name === ".git") {
        continue;
      }
      const absolutePath = path.resolve(currentDir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...await listTaskFilesForGit(dir, absolutePath, relativePath));
        continue;
      }
      if (entry.isFile()) {
        files.push(relativePath.replace(/\\/g, "/"));
      }
    }
    return files;
  }

  async function ensureTaskGitBaseline(taskDir, message = "Initial task version") {
    const dir = path.resolve(taskDir);
    let gitDirExists = false;
    try {
      const stats = await fs.promises.stat(path.resolve(dir, ".git"));
      gitDirExists = stats.isDirectory() || stats.isFile();
    } catch (_) {
      gitDirExists = false;
    }

    if (!gitDirExists) {
      try {
        await git.init({ fs, dir, defaultBranch: "main" });
      } catch (_) {
        await git.init({ fs, dir });
      }
    }

    let hasHead = false;
    try {
      await git.resolveRef({ fs, dir, ref: "HEAD" });
      hasHead = true;
    } catch (_) {
      hasHead = false;
    }
    if (hasHead) {
      return false;
    }

    const files = await listTaskFilesForGit(dir);
    if (files.length === 0) {
      return false;
    }

    for (const filepath of files.sort()) {
      await git.add({ fs, dir, filepath });
    }
    await git.commit({
      fs,
      dir,
      message,
      author: {
        name: "Pinokio",
        email: "noreply@pinokio.local"
      }
    });
    return true;
  }

  async function readTaskPackageById(id) {
    const normalizedId = normalizeTaskId(id);
    if (!normalizedId) {
      const error = new Error("Invalid task id.");
      error.status = 400;
      throw error;
    }
    const taskDir = taskDirForId(normalizedId);
    const taskConfigPath = path.resolve(taskDir, TASK_CONFIG_FILENAME);
    const taskTemplatePath = path.resolve(taskDir, TASK_TEMPLATE_FILENAME);
    let rawConfig;
    let template;
    try {
      rawConfig = JSON.parse(await fs.promises.readFile(taskConfigPath, "utf8"));
    } catch (error) {
      const nextError = new Error("Task configuration not found.");
      nextError.status = 404;
      throw nextError;
    }
    try {
      template = await fs.promises.readFile(taskTemplatePath, "utf8");
    } catch (error) {
      const nextError = new Error("Task template not found.");
      nextError.status = 404;
      throw nextError;
    }
    const config = validateTaskConfig(rawConfig);
    validateTaskSchema(config, template);
    const inputs = buildTaskInputs(config, template);
    return {
      id: normalizedId,
      dir: taskDir,
      config,
      template,
      inputs
    };
  }

  async function findTaskIndexEntryByRef(ref) {
    const normalizedRef = normalizeTaskRef(kernel, ref);
    if (!normalizedRef) {
      return null;
    }
    const index = await readTaskIndex();
    const entry = index.items.find((item) => item.ref === normalizedRef) || null;
    return {
      index,
      entry,
      ref: normalizedRef
    };
  }

  async function resolveTaskPackage({ id, ref }) {
    const normalizedId = normalizeTaskId(id);
    if (normalizedId) {
      try {
        const task = await readTaskPackageById(normalizedId);
        return {
          ...task,
          ref: ""
        };
      } catch (error) {
        if (error && error.status === 404) {
          return null;
        }
        throw error;
      }
    }
    const match = await findTaskIndexEntryByRef(ref);
    if (!match || !match.entry) {
      return null;
    }
    try {
      const task = await readTaskPackageById(match.entry.id);
      return {
        ...task,
        ref: match.ref
      };
    } catch (error) {
      if (error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function upsertTaskRef(id, ref) {
    const normalizedId = normalizeTaskId(id);
    if (!normalizedId) {
      const error = new Error("Invalid task id.");
      error.status = 400;
      throw error;
    }
    const normalizedRef = normalizeTaskRef(kernel, ref);
    if (!normalizedRef) {
      const error = new Error("Task ref is required.");
      error.status = 400;
      throw error;
    }
    const index = await readTaskIndex();
    const entryIndex = index.items.findIndex((entry) => entry.id === normalizedId);
    if (entryIndex === -1) {
      const error = new Error("Task not found.");
      error.status = 404;
      throw error;
    }
    index.items[entryIndex] = {
      id: normalizedId,
      ref: normalizedRef
    };
    await writeTaskIndex(index);
    return {
      id: normalizedId,
      ref: normalizedRef
    };
  }

  async function listInstalledTasks() {
    const index = await readTaskIndex();
    const items = [];
    for (const entry of index.items) {
      try {
        const task = await readTaskPackageById(entry.id);
        items.push({
          id: entry.id,
          ref: entry.ref || "",
          title: task.config.title,
          description: task.config.description,
          template: task.template,
          path: task.config.path,
          target: task.config.target,
          inputs: task.inputs,
          dir: task.dir
        });
      } catch (_) {
      }
    }
    return items.sort((a, b) => {
      const at = (a.title || "").toLowerCase();
      const bt = (b.title || "").toLowerCase();
      if (at < bt) return -1;
      if (at > bt) return 1;
      return a.id.localeCompare(b.id);
    });
  }

  async function createLocalTaskPackage({ rawConfig, template }) {
    const normalizedTemplate = typeof template === "string" ? template : "";
    if (!normalizedTemplate.trim()) {
      const error = new Error("Task template is required.");
      error.status = 400;
      throw error;
    }
    const config = buildTaskConfigForWrite(rawConfig, normalizedTemplate);

    const allocation = await allocateTaskId();
    const taskDir = taskDirForId(allocation.id);
    await fs.promises.mkdir(taskDir, { recursive: false });
    try {
      await fs.promises.writeFile(
        path.resolve(taskDir, TASK_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );
      await fs.promises.writeFile(path.resolve(taskDir, TASK_TEMPLATE_FILENAME), normalizedTemplate);
      await ensureTaskGitBaseline(taskDir, "Create task").catch(() => {});
      allocation.index.items.push({ id: allocation.id });
      allocation.index.nextId = allocation.nextValue + 1;
      await writeTaskIndex(allocation.index);
      return readTaskPackageById(allocation.id);
    } catch (error) {
      await fs.promises.rm(taskDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function installRemoteTaskPackage({ ref }) {
    const rawRef = typeof ref === "string" ? ref.trim() : "";
    const normalizedRef = normalizeTaskRef(kernel, rawRef);
    if (!rawRef || !normalizedRef) {
      const error = new Error("Task ref is required.");
      error.status = 400;
      throw error;
    }
    const existing = await findTaskIndexEntryByRef(rawRef);
    if (existing && existing.entry) {
      return readTaskPackageById(existing.entry.id);
    }

    const allocation = await allocateTaskId();
    const taskDir = taskDirForId(allocation.id);
    await fs.promises.mkdir(tasksRoot(), { recursive: true });
    try {
      await kernel.exec({
        message: [`git clone --depth 1 --single-branch ${shellQuote(rawRef)} ${shellQuote(taskDir)}`],
        path: tasksRoot()
      }, () => {});
      await readTaskPackageById(allocation.id);
      allocation.index.items.push({
        id: allocation.id,
        ref: normalizedRef
      });
      allocation.index.nextId = allocation.nextValue + 1;
      await writeTaskIndex(allocation.index);
      return readTaskPackageById(allocation.id);
    } catch (error) {
      await fs.promises.rm(taskDir, { recursive: true, force: true }).catch(() => {});
      const nextError = new Error(error && error.message ? error.message : "Failed to install task.");
      nextError.status = error && error.status ? error.status : 500;
      if (error && error.validation) {
        nextError.validation = error.validation;
      } else if (error && error.status === 400) {
        nextError.validation = {
          type: "task",
          title: "Invalid Task",
          message: nextError.message,
          errors: [{
            message: nextError.message,
            fix: "Review pinokio.json and task.md, then try importing again."
          }]
        };
      }
      throw nextError;
    }
  }

  async function updateTaskPackage({ id, rawConfig, template }) {
    const normalizedId = normalizeTaskId(id);
    if (!normalizedId) {
      const error = new Error("Invalid task id.");
      error.status = 400;
      throw error;
    }
    const normalizedTemplate = typeof template === "string" ? template : "";
    if (!normalizedTemplate.trim()) {
      const error = new Error("Task template is required.");
      error.status = 400;
      throw error;
    }
    const existing = await readTaskPackageById(normalizedId);
    const config = buildTaskConfigForWrite(rawConfig, normalizedTemplate);

    await ensureTaskGitBaseline(existing.dir, "Initial task version").catch(() => {});
    await fs.promises.writeFile(
      path.resolve(existing.dir, TASK_CONFIG_FILENAME),
      JSON.stringify(config, null, 2)
    );
    await fs.promises.writeFile(path.resolve(existing.dir, TASK_TEMPLATE_FILENAME), normalizedTemplate);
    return readTaskPackageById(normalizedId);
  }

  async function deleteTaskPackage(id) {
    const normalizedId = normalizeTaskId(id);
    if (!normalizedId) {
      const error = new Error("Invalid task id.");
      error.status = 400;
      throw error;
    }
    const index = await readTaskIndex();
    const entryIndex = index.items.findIndex((entry) => entry.id === normalizedId);
    if (entryIndex === -1) {
      const error = new Error("Task not found.");
      error.status = 404;
      throw error;
    }
    index.items.splice(entryIndex, 1);
    await writeTaskIndex(index);
    await fs.promises.rm(taskDirForId(normalizedId), { recursive: true, force: true });
    return { id: normalizedId };
  }

  return {
    TASK_CONFIG_FILENAME,
    TASK_TEMPLATE_FILENAME,
    applyTemplateValues,
    buildTaskInputs,
    buildTaskConfigForWrite,
    createLocalTaskPackage,
    deleteTaskPackage,
    extractInputValues,
    extractTemplateVariableNames,
    findTaskIndexEntryByRef,
    installRemoteTaskPackage,
    listInstalledTasks,
    normalizeTaskId,
    normalizeTaskRef: (value) => normalizeTaskRef(kernel, value),
    readTaskIndex,
    readTaskPackageById,
    resolveTaskPackage,
    slugify,
    upsertTaskRef,
    taskDirForId,
    tasksRoot,
    updateTaskPackage,
    validateTaskConfig,
    validateTaskSchema,
    writeTaskIndex
  };
}

module.exports = {
  applyTemplateValues,
  buildTaskConfigForWrite,
  buildTaskInputs,
  createTaskPackageService,
  extractInputValues,
  extractTemplateVariableNames,
  normalizeTaskId,
  slugify,
  validateTaskConfig
};
