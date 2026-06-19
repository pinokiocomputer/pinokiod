const express = require('express');
const path = require('path');
const fs = require('fs');
const { isBinaryFile } = require('isbinaryfile');

const MAX_EDITABLE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB safety limit

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const sanitizeSegments = (value) => {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '') {
    return [];
  }
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw createHttpError(400, 'Invalid path');
  }
  return segments;
};

module.exports = function registerFileRoutes(app, { kernel, getTheme, exists }) {
  if (!app || !kernel) {
    throw new Error('File routes require an express app and kernel instance');
  }

  const router = express.Router();

  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };


  const ensureWorkspace = async (workspaceParam, rootParam) => {
    const apiRoot = kernel.path('api');
    if (rootParam) {
      let decodedRoot;
      try {
        decodedRoot = Buffer.from(String(rootParam), 'base64').toString('utf8');
      } catch (error) {
        throw createHttpError(400, 'Invalid workspace descriptor');
      }
      if (!decodedRoot) {
        throw createHttpError(400, 'Invalid workspace descriptor');
      }
      const normalizedRoot = path.resolve(decodedRoot);
      if (!path.isAbsolute(normalizedRoot)) {
        throw createHttpError(400, 'Workspace path must be absolute');
      }
      const relativeToHome = path.relative(kernel.homedir, normalizedRoot);
      if (relativeToHome.startsWith('..') || path.isAbsolute(relativeToHome)) {
        throw createHttpError(400, 'Workspace outside Pinokio home');
      }
      const relativeToApi = path.relative(apiRoot, normalizedRoot);
      if (relativeToApi.startsWith('..') || path.isAbsolute(relativeToApi)) {
        throw createHttpError(400, 'Workspace outside api directory');
      }
      const existsResult = await exists(normalizedRoot);
      if (!existsResult) {
        throw createHttpError(404, 'Workspace not found');
      }
      const segments = sanitizeSegments(workspaceParam || relativeToApi);
      const effectiveSegments = segments.length > 0 ? segments : sanitizeSegments(relativeToApi);
      const slugSegments = effectiveSegments.length > 0 ? effectiveSegments : [path.basename(normalizedRoot)];
      return {
        apiRoot,
        segments: slugSegments,
        workspaceRoot: normalizedRoot,
        workspaceLabel: slugSegments[slugSegments.length - 1],
        workspaceSlug: slugSegments.join('/'),
      };
    }

    if (!workspaceParam || typeof workspaceParam !== 'string') {
      throw createHttpError(400, 'Missing workspace');
    }

    const segments = sanitizeSegments(workspaceParam);
    if (segments.length === 0) {
      throw createHttpError(400, 'Workspace path is required');
    }

    const workspaceRoot = path.resolve(apiRoot, ...segments);
    const relativeToApi = path.relative(apiRoot, workspaceRoot);
    if (relativeToApi.startsWith('..') || path.isAbsolute(relativeToApi)) {
      throw createHttpError(400, 'Workspace outside api directory');
    }
    const existsResult = await exists(workspaceRoot);
    if (!existsResult) {
      throw createHttpError(404, 'Workspace not found');
    }
    return {
      apiRoot,
      segments,
      workspaceRoot,
      workspaceLabel: segments[segments.length - 1],
      workspaceSlug: segments.join('/'),
    };
  };

  const resolveWorkspacePath = async (workspaceParam, relativeParam = '', rootParam) => {
    const workspaceInfo = await ensureWorkspace(workspaceParam, rootParam);
    const relativeSegments = sanitizeSegments(relativeParam);
    const absolutePath = path.resolve(workspaceInfo.workspaceRoot, ...relativeSegments);
    const relativeToWorkspace = path.relative(workspaceInfo.workspaceRoot, absolutePath);
    if (relativeToWorkspace.startsWith('..') || path.isAbsolute(relativeToWorkspace)) {
      throw createHttpError(400, 'Path escapes workspace');
    }
    const relativePosix = relativeSegments.join('/');
    return {
      ...workspaceInfo,
      absolutePath,
      relativeSegments,
      relativePosix,
    };
  };

  router.get('/pinokio/fileview/*', asyncHandler(async (req, res) => {
    const workspaceParam = req.params[0] || '';
    const initialRelative = req.query.path || '';
    const { workspaceRoot, workspaceLabel, workspaceSlug, relativePosix, absolutePath } = await resolveWorkspacePath(workspaceParam, initialRelative);
    const initialPosixPath = relativePosix;
    const initialStats = await fs.promises.stat(absolutePath).catch(() => null);
    const initialType = initialStats ? (initialStats.isDirectory() ? 'directory' : initialStats.isFile() ? 'file' : null) : null;

    const workspaceMeta = {
      title: '',
      description: '',
      icon: '',
      iconpath: ''
    };
    try {
      const meta = await kernel.api.meta(workspaceSlug);
      if (meta && typeof meta === 'object') {
        workspaceMeta.title = typeof meta.title === 'string' ? meta.title : '';
        workspaceMeta.description = typeof meta.description === 'string' ? meta.description : '';
        workspaceMeta.icon = typeof meta.icon === 'string' ? meta.icon : '';
        workspaceMeta.iconpath = typeof meta.iconpath === 'string' ? meta.iconpath : '';
      }
    } catch (error) {
      // Metadata is optional for the file editor; ignore failures.
    }

    const workspaceRootEncoded = Buffer.from(workspaceRoot).toString('base64');
    res.render('file_browser', {
      theme: getTheme ? getTheme() : 'light',
      agent: req.agent,
      workspace: workspaceSlug,
      workspaceLabel,
      workspaceRoot,
      workspaceSlug,
      workspaceRootEncoded,
      initialPath: initialPosixPath,
      initialPathType: initialType,
      workspaceMeta
    });
  }));

  router.get('/api/files/list', asyncHandler(async (req, res) => {
    const { workspace, path: relativeQuery } = req.query;
    const { absolutePath, relativePosix, workspaceSlug } = await resolveWorkspacePath(workspace, relativeQuery, req.query.root);

    const stats = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stats) {
      throw createHttpError(404, 'Directory not found');
    }
    if (!stats.isDirectory()) {
      throw createHttpError(400, 'Path must be a directory');
    }

    const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const items = await Promise.all(sorted.map(async (dirent) => {
      const entrySegments = [...(relativePosix ? relativePosix.split('/') : []), dirent.name];
      const entryPosix = entrySegments.filter(Boolean).join('/');
      let hasChildren = false;
      if (dirent.isDirectory()) {
        const candidatePath = path.resolve(absolutePath, dirent.name);
        try {
          const childDir = await fs.promises.opendir(candidatePath);
          let count = 0;
          for await (const child of childDir) {
            count += 1;
            if (count > 0) {
              hasChildren = true;
              break;
            }
          }
          await childDir.close();
        } catch (err) {
          hasChildren = false;
        }
      }
      return {
        name: dirent.name,
        path: entryPosix,
        type: dirent.isDirectory() ? 'directory' : 'file',
        workspace: workspaceSlug,
        hasChildren,
      };
    }));

    res.json({
      workspace: workspaceSlug,
      path: relativePosix,
      entries: items,
    });
  }));

  router.get('/api/files/read', asyncHandler(async (req, res) => {
    const { workspace, path: relativeQuery } = req.query;
    const { absolutePath, relativePosix, workspaceSlug } = await resolveWorkspacePath(workspace, relativeQuery, req.query.root);

    const stats = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stats) {
      throw createHttpError(404, 'File not found');
    }
    if (!stats.isFile()) {
      throw createHttpError(400, 'Path must be a file');
    }
    const metaOnly = Object.prototype.hasOwnProperty.call(req.query, 'meta');
    if (metaOnly) {
      res.json({
        workspace: workspaceSlug,
        path: relativePosix,
        size: stats.size,
        mtime: stats.mtimeMs,
        meta: true,
      });
      return;
    }
    if (stats.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
      throw createHttpError(413, 'File is too large to open in the editor');
    }
    const isBinary = await isBinaryFile(absolutePath);
    if (isBinary) {
      throw createHttpError(415, 'Binary files cannot be opened in the editor');
    }
    const content = await fs.promises.readFile(absolutePath, 'utf8');
    res.json({
      workspace: workspaceSlug,
      path: relativePosix,
      content,
      size: stats.size,
      mtime: stats.mtimeMs,
    });
  }));

  router.post('/api/files/save', asyncHandler(async (req, res) => {
    const { workspace, path: relativePath, content, root: rootParam } = req.body || {};
    if (typeof content !== 'string') {
      throw createHttpError(400, 'File content must be a string');
    }

    const { absolutePath, relativePosix, workspaceSlug } = await resolveWorkspacePath(workspace, relativePath, rootParam);
    const stats = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stats) {
      throw createHttpError(404, 'File not found');
    }
    if (!stats.isFile()) {
      throw createHttpError(400, 'Path must be a file');
    }

    await fs.promises.writeFile(absolutePath, content, 'utf8');
    const updatedStats = await fs.promises.stat(absolutePath);
    res.json({
      workspace: workspaceSlug,
      path: relativePosix,
      size: updatedStats.size,
      mtime: updatedStats.mtimeMs,
    });
  }));

  router.post('/api/files/delete', asyncHandler(async (req, res) => {
    const { workspace, path: relativePath, root: rootParam } = req.body || {};
    if (typeof relativePath !== 'string') {
      throw createHttpError(400, 'Path must be provided');
    }

    const resolved = await resolveWorkspacePath(workspace, relativePath, rootParam);
    const { absolutePath, relativePosix, workspaceSlug } = resolved;

    if (!relativePosix) {
      throw createHttpError(400, 'Cannot delete workspace root');
    }

    const stats = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stats) {
      throw createHttpError(404, 'Path not found');
    }

    let removedType;
    if (stats.isDirectory()) {
      await fs.promises.rm(absolutePath, { recursive: true, force: true });
      removedType = 'directory';
    } else if (stats.isFile()) {
      await fs.promises.unlink(absolutePath);
      removedType = 'file';
    } else {
      throw createHttpError(400, 'Unsupported file type');
    }

    res.json({
      workspace: workspaceSlug,
      path: relativePosix,
      type: removedType,
      success: true,
    });
  }));

  router.post('/api/files/rename', asyncHandler(async (req, res) => {
    const { workspace, path: relativePath, name: newName, root: rootParam } = req.body || {};
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw createHttpError(400, 'Path must be provided');
    }
    if (typeof newName !== 'string' || newName.trim().length === 0) {
      throw createHttpError(400, 'New name must be provided');
    }

    const sanitizedName = newName.trim();
    if (sanitizedName.includes('/') || sanitizedName.includes('\\')) {
      throw createHttpError(400, 'Name cannot contain path separators');
    }

    const resolved = await resolveWorkspacePath(workspace, relativePath, rootParam);
    const { absolutePath, relativePosix, workspaceSlug, workspaceRoot } = resolved;

    if (!relativePosix) {
      throw createHttpError(400, 'Cannot rename workspace root');
    }

    const sourceStats = await fs.promises.stat(absolutePath).catch(() => null);
    if (!sourceStats) {
      throw createHttpError(404, 'Source path not found');
    }

    const parentSegments = resolved.relativeSegments.slice(0, -1);
    const sourceName = resolved.relativeSegments[resolved.relativeSegments.length - 1];
    if (sourceName === sanitizedName) {
      res.json({
        workspace: workspaceSlug,
        path: relativePosix,
        target: relativePosix,
        success: true,
        unchanged: true,
      });
      return;
    }

    const targetAbsolute = path.resolve(workspaceRoot, ...parentSegments, sanitizedName);
    const relativeTargetSegments = sanitizeSegments([...parentSegments, sanitizedName].join('/'));
    const relativeTarget = relativeTargetSegments.join('/');
    const collision = await fs.promises.stat(targetAbsolute).catch(() => null);
    if (collision) {
      throw createHttpError(409, 'A file or folder with that name already exists');
    }

    await fs.promises.rename(absolutePath, targetAbsolute);

    const targetStats = await fs.promises.stat(targetAbsolute);
    res.json({
      workspace: workspaceSlug,
      path: relativePosix,
      target: relativeTarget,
      type: targetStats.isDirectory() ? 'directory' : targetStats.isFile() ? 'file' : 'other',
      success: true,
    });
  }));

  app.use(router);
};
