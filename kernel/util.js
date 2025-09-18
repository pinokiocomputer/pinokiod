const fs = require('fs')
const { spawn } = require('child_process')
const Clipboard = require('copy-paste/promises');
const http = require('http');
const notifier = require('node-notifier');
const os = require('os')
const net = require('node:net')
const path = require('path')
const dotenv = require('dotenv')
const symlinkDir = require('symlink-dir')
const retry = require('async-retry');
const child_process = require('node:child_process');
const {auto: normalizeEOL} = require("eol");
const {EOL} = require("os");
const breakPattern = /\n/g;
const breakReplacement = "\\n";
const groupPattern = /\$/g;
const groupReplacement = "$$$";
const h = "[^\\S\\r\\n]";  // simulate `\h`
const returnPattern = /\r/g;
const returnReplacement = "\\r";
const {
  glob
} = require('glob')


  const platform = os.platform()
// asar handling for go-get-folder-size
let g
if( __dirname.includes(".asar") ) {
  let root = /(.+\.asar)/.exec(__dirname);
  g = require(path.join(root[1] + ".unpacked", 'node_modules', 'go-get-folder-size'));
} else {
  g = require('go-get-folder-size');
}
const { getFolderSize, getFolderSizeBin, getFolderSizeWasm, } = g
const du = async (folderpath) => {
  let totalSize = await getFolderSizeBin(folderpath)
  return totalSize;
}

const symlink = async(req, ondata, kernel) => {
/*
  req := {
    from: <the link path to create>,
    to: <the path the link points to>
  }
*/
  const result = await symlinkDir(req.to, req.from)
  
}
const clipboard = async (req, ondata, kernel) => {
/*
  req := {
    type: "copy"|"paste",
    text: <text (only when copy)>
  }
*/
  if (req.type === "copy") {
    await Clipboard.copy(req.text)
  } else if (req.type === "paste") {
    let content = await Clipboard.paste()
    return content
  }
}

const filepicker = async(req, ondata, kernel) => {
  if (req.params.filetype) {
    /*
      2 types:
        filetype: [ 'images/*.png,*.jpg', 'docs/*.pdf' ]
        filetype: 'images/*.png,*.jpg', 'docs/*.pdf'
    */
    let filetype
    if (Array.isArray(req.params.filetype)) {
      filetype = req.params.filetype
    } else {
      filetype = [req.params.filetype]
    }
    req.params.filetypes = filetype.map((str) => {
      let chunks = str.split("/")
      let type = chunks[0]
      let extensions = chunks[1].split(",").join(" ")
      return [type, extensions]
    })
  }
  console.log("Filetype", req.params.filetype)
  console.log("Filetypes", req.params.filetypes)
  let response = await new Promise((resolve, reject) => {
    let picker_path = kernel.path("bin/py/picker.py")
    let python
    if (kernel.platform === "win32") {
      python = kernel.path("bin/miniconda/python")
    } else {
      python = kernel.path("bin/miniconda/bin/python")
    }
    console.log("run python", { python, picker_path })
    const proc = spawn(python, [picker_path])

    let output = "";
    proc.stdout.on("data", (chunk) => output += chunk);
    proc.stderr.on("data", (err) => console.error("Python error:", err.toString()));
    proc.on("close", () => {
      try {
        const result = JSON.parse(output);
        if (result.error) return reject(result.error);
        resolve(result.paths); // Always an array
      } catch (e) {
        reject("Failed to parse Python output: " + output);
      }
    });

    proc.stdin.write(JSON.stringify(req.params));
    proc.stdin.end();
  });
  return { paths: response }
}

let file_type = async (cwd, file) => {
  if (file.isDirectory()) {
    return {
      directory: true,
    }
  } else if (file.isFile()) {
    return {
      file: true
    }
  } else if (file.isSymbolicLink()) {
    try {
      const fullPath = path.join(cwd, file.name);
      const targetStats = await fs.promises.stat(fullPath);
      if (targetStats.isDirectory()) {
        return {
          directory: true,
          link: true,
        }
      } else if (targetStats.isFile()) {
        return {
          file: true,
          link: true,
        }
      }
    } catch (err) {
      console.error(`${file.name} → broken symlink (${err.message})`);
      return {
        link: true
      }
    }
  } else {
    return { }
  }
}

const is_port_available = async (port) => {
  return new Promise((resolve) => {
    const server = http.createServer();
    try {
      server.listen(port, (err) => {
        if (err) {
          resolve(false); // Port is occupied
        } else {
          server.close(() => {
            resolve(true); // Port is free
          }); // Close the server immediately after testing
        }
      });
      server.on('error', (err) => {
        resolve(false); // Port is occupied
      });
    } catch (e) {
      resolve(false) // port not available
    }
  });
};

const port_running = async (host, port) => {
  const timeout = 1000
  const promise = new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const onError = (e) => {
      socket.destroy();
      reject();
    };
    socket.setTimeout(timeout);
    socket.once('error', onError);
    socket.once('timeout', onError);
    socket.connect(port, host, () => {
      socket.end();
      resolve();
    });
  });
  try {
    await promise;
    return true
  } catch (e) {
    return false
  }
}

const parse_env = async (filename) => {
  try {
    const buf = await fs.promises.readFile(filename)
    const config = dotenv.parse(buf) // will return an object
    return config
  } catch (e) {
    return {}
  }
}

const exists= (abspath) => {
  return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
}
const log = async (filepath, str, session) => {
  if (str && str.trim().length > 0) {
    try {
      await fs.promises.mkdir(filepath, { recursive: true })
    } catch (e) {
    }

    let output = '';
    for (let line of str.split('\n')) {
      line = line.split('\r').pop(); // handle overwriting lines
      output += line + '\n';
    }

    const pattern = [
      '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-Za-z=><~]))'
    ].join('|');
    const regex = new RegExp(pattern, 'gi')
    let stripped = str.replaceAll(regex, '');

    // write to session
    let logpath = path.resolve(filepath, session)
    await fs.promises.writeFile(logpath, stripped)

    // create latest from last 10 sessions

    let dirpath = path.dirname(filepath)


    let latest_logpath = path.resolve(filepath, "latest")
    await fs.promises.writeFile(latest_logpath, stripped)
  }
}
const run = (cmd, cwd, kernel) => {
//  console.log("Util.run", { cmd, cwd })
//  child_process.exec(cmd, { cwd })
  if (kernel) {
    kernel.exec({
      message: cmd,
      path: cwd
    }, (e) => {
      process.stdout.write(e.raw)
    }).then(() => {
      console.log("DONE")
    })
  } else {
    child_process.exec(command)
  }
}
const openURL = (url) => {
  const platform = os.platform()
  let command;
  if (platform === 'darwin') {
    command = `open "${url}"`; // macOS
  } else if (platform === 'win32') {
    command = `start "" "${url}"`; // Windows
  } else {
    command = `xdg-open "${url}"`; // Linux
  }
  child_process.exec(command);
}
const openfs = (dirPath, options, kernel) => {
  let command = '';
  const platform = os.platform()
  console.log("openfs", dirPath, options)
  if (options && (options.command || options.action)) {
    let mode = "view"
    if (options.command) {
      mode = options.command
    } else if (options.action) {
      mode = options.action
    }
    console.log("> mode", mode)
    if (mode === "view") {
      switch (platform) {
        case 'darwin':
          command = `open -R "${dirPath}"`;
          break;
        case 'win32':
          command = `explorer /select,"${dirPath}" & timeout /t 1 >nul`;
          break;
        default:
          command = `xdg-open "${dirPath}"`;
          break;
      }
      child_process.exec(command)
    } else if (mode === "open") {
      switch (platform) {
        case 'darwin':
          command = `open "${dirPath}"`;
          break;
        case 'win32':
          command = `explorer "${dirPath}"`;
          break;
        default:
          command = `xdg-open "${dirPath}"`;
          break;
      }
      child_process.exec(command)
    } else {
      command = `${mode} "${dirPath}"`
      console.log("> command", command)
      if (kernel) {
        kernel.exec({
          message: command,
        }, (e) => {
          process.stdout.write(e.raw)
        }).then(() => {
          console.log("DONE")
        })
      } else {
        child_process.exec(command)
      }
    }
  } else {
    let mode = "view"
    if (options && options.mode) {
      mode = options.mode
    }
    if (mode === "view") {
      switch (platform) {
        case 'darwin':
          command = `open -R "${dirPath}"`;
          break;
        case 'win32':
          command = `explorer /select,"${dirPath}" & timeout /t 1 >nul`;
          break;
        default:
          command = `xdg-open "${dirPath}"`;
          break;
      }
    } else if (mode === "open") {
      switch (platform) {
        case 'darwin':
          command = `open "${dirPath}"`;
          break;
        case 'win32':
          command = `explorer "${dirPath}"`;
          break;
        default:
          command = `xdg-open "${dirPath}"`;
          break;
      }
    }
    child_process.exec(command)
  }
}
const parse_env_detail = async (filename) => {
  // takes env and returns an array
  const config = parse_env(filename)
  /*
    config := {
      key1: val1,
      key2; val2,
      ...
    }
  */
  const keys = Object.keys(config)
  const str = await fs.promises.readFile(filename, "utf8")
  const lines = str.split(/[\r\n]+/)

  let items = []

  for(let line of lines) {
    if (line.trim().startsWith("#")) {
      items.push({
        type: "comment",
        val: line
      })
    } else {
      const buf = Buffer.from(line)
      const parsed = dotenv.parse(buf)
      const key = Object.keys(parsed)
      if (key.length > 0) {
        items.push({ key: key[0], val: parsed[key[0]] })
      }
    }
  }
  /*
  items := [{
    type: "comment",
    val: "###################################",
  }, {
    type: "comment",
    val: "# this is a comment",
  }, {
    key: "TMPDIR",
    val: "/tmp"
  }]
  */
  return items
}
const log_path = (fullpath, kernel) => {
  let api_path = `${kernel.homedir}${path.sep}api`
  let rel_path = path.relative(api_path, fullpath)
  let log_root = `${kernel.homedir}${path.sep}logs`
  let current_log_path = path.resolve(log_root, "shell/cleaned/api", rel_path)
  return current_log_path
}
const api_name = (fullpath, kernel) => {
  let api_path = `${kernel.homedir}${path.sep}api`
  let rel_path = path.relative(api_path, fullpath)
  let api_name = rel_path.split(path.sep)[0]
  return api_name
}
const api_path = (fullpath, kernel) => {
  let api_path = `${kernel.homedir}${path.sep}api`
  let rel_path = path.relative(api_path, fullpath)
  let api_name = rel_path.split(path.sep)[0]
  let current_api_path = `${api_path}${path.sep}${api_name}`
  return current_api_path
}
const escapeStringRegexp = (string) => {
	if (typeof string !== 'string') {
		throw new TypeError('Expected a string');
	}

	// Escape characters with special meaning either inside or outside character sets.
	// Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
	return string
		.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
		.replace(/-/g, '\\x2d');
}

const find_python = async (root) => {
  let python_pattern
  if (os.platform() === "win32") {
    python_pattern = "**/python.exe";
  } else {
    python_pattern = "**/python"; // Matches python, python3, python3.x
  }
  const pythonBinaries = await glob(python_pattern, { nodir: true, cwd: root });
  return pythonBinaries
}
const find_venv = async (root) => {
  let python_pattern
  if (os.platform() === "win32") {
    python_pattern = "**/python.exe";
  } else {
    python_pattern = "**/python"; // Matches python, python3, python3.x
  }
  const pythonBinaries = await glob(python_pattern, { nodir: true, cwd: root, absolute: true });
  const venvs = pythonBinaries.map((p) => {
    return path.resolve(p, "../..") 
  })
  return venvs
}

const update_env = async (filepath, changes) => {
  const env = await fs.promises.readFile(filepath, "utf8")
  let append = false;
  const newval = Object.keys(changes).reduce((result, varname) => {
    const value = changes[varname].toString()
    .replace(breakPattern, breakReplacement)
    .replace(returnPattern, returnReplacement)
    .trim();
    const safeName = escapeStringRegexp(varname);
    //const varPattern = new RegExp(`^(${h}*${safeName}${h}*=${h}*)\\S*(${h}*)$`, "gm");
    const varPattern = new RegExp(`^(${h}*${safeName}${h}*=${h}*)(\\S(?:.*\\S)?)?(${h}*)$`, "gm");
    if (varPattern.test(result)) {
      const safeValue = value.replace(groupPattern, groupReplacement);
      //return result.replace(varPattern, `$1${safeValue}$2`);
      return result.replace(varPattern, `$1${safeValue}$3`);
    } else if (result === "") {
      append = true;
      return `${varname}=${value}${EOL}`;
    } else if (!result.endsWith(EOL) && !append) {
      append = true;
      // Add an extra break between previously defined and newly appended variable
      return `${result}${EOL}${EOL}${varname}=${value}`;
    } else if (!result.endsWith(EOL)) {
      // Add break for appended variable
      return `${result}${EOL}${varname}=${value}`;
    } else if (result.endsWith(EOL) && !append) {
      append = true;
      // Add an extra break between previously defined and newly appended variable
      return `${result}${EOL}${varname}=${value}${EOL}`;
    } else {
      // Add break for appended variable
      return `${result}${varname}=${value}${EOL}`;
    }
  }, normalizeEOL(env));
  await fs.promises.writeFile(filepath, newval)
};
function fill_object(obj, pattern, list, cache) {
  const map = {};
  const replaced_map = cache || {}
  let index = 0;

  function recurse(value) {
    if (typeof value === 'string') {
      return value.replace(pattern, (match) => {
        if (!(match in map)) {
          if (replaced_map[match]) {
            map[match] = replaced_map[match]
//            console.log("filling with cache", { match, replaced: replaced_map[match] })
          } else {
            if (index >= list.length) throw new Error("Not enough items provided");
            map[match] = list[index++];
            replaced_map[match] = map[match]
//            console.log("filling with new", { match, replaced: replaced_map[match] })
          }
        }
        return map[match];
      });
    } else if (Array.isArray(value)) {
      return value.map(recurse);
    } else if (value && typeof value === 'object') {
      const newObj = {};
      for (const [k, v] of Object.entries(value)) {
        newObj[k] = recurse(v);
      }
      return newObj;
    }
    return value;
  }

  let res = recurse(obj);
  return { result: res, replaced_map }
}
function push(params) {
  /*
  params :- {
    title: <string>,
    subtitle: <string>, 
    message: <string>,
    image: <image path>,
    sound: true|false,
  }
  */
  if (params.image && !params.contentImage) {
    params.contentImage = params.image
  }
  if (!params.title) {
    params.title = "Pinokio"
  }
  console.log("Notifier.notify", params)
  notifier.notify(params)
}
function p2u(localPath) {
  /*
    unix-like: /users/b/c => users/b/c
    windows: C:\\\users\b\c => c/users/b/c
  */
  if (platform === 'win32') {
    const match = localPath.match(/^([a-zA-Z]):\\(.*)/);
    const drive = match[1].toLowerCase();
    const path = match[2].replace(/\\/g, '/');
    return `/${drive}/${path}`;
  } else {
    if (localPath.startsWith("/")) {
      return localPath.slice(1)
    } else {
      return localPath
    }
  }
}
function u2p(urlPath) {
  /*
    unix-like: users/b/c => /users/b/c/
    windows: c/users/b/c => C:\\users\b\c
  */
  const parts = urlPath.split('/');
  if (platform === 'win32') {
    const drive = parts[0];
    return `${drive.toUpperCase()}:\\${parts.slice(1).join("\\")}`
  } else {
    return `/${parts.join("/")}`
  }
}

function classifyChange(head, workdir, stage) {
  if (head === 0 && workdir === 0 && stage === 0) return null; // shouldn't appear
  if (head === 0 && workdir === 3) return 'untracked';
  if (head === 0 && stage === 3) return 'added (staged)';
  if (head === 1 && workdir === 0 && stage === 0) return 'deleted (unstaged)';
  if (head === 1 && workdir === 0 && stage === 0) return 'deleted (staged)';
  if (head === 1 && workdir === 2 && stage === 0) return 'modified (unstaged)';
  if (head === 1 && workdir === 1 && stage === 2) return 'modified (staged)';
  if (head === 1 && workdir === 2 && stage === 2) return 'modified (staged + unstaged)';
  if (head === 1 && workdir === 1 && stage === 0) return 'clean';
  return `unknown (${head},${workdir},${stage})`;
}


function diffLinesWithContext(diffs, context = 3) {
  const result = [];
  let lineOld = 1;
  let lineNew = 1;

  const blocks = [];
  let i = 0;

  while (i < diffs.length) {
    if (!diffs[i].added && !diffs[i].removed) {
      // Flatten unchanged lines
      const lines = [];
      while (i < diffs.length && !diffs[i].added && !diffs[i].removed) {
        const split = diffs[i].value.split('\n');
        if (split[split.length - 1] === '') split.pop();
        for (const line of split) {
          lines.push({
            line,
            lineOld,
            lineNew,
          });
          lineOld++;
          lineNew++;
        }
        i++;
      }
      blocks.push({ type: 'context', lines });
    } else {
      // Change block (added or removed)
      const change = [];
      while (i < diffs.length && (diffs[i].added || diffs[i].removed)) {
        const split = diffs[i].value.split('\n');
        if (split[split.length - 1] === '') split.pop();
        const type = diffs[i].added ? 'add' : 'del';

        for (const line of split) {
          change.push({
            line,
            lineOld: type === 'add' ? '' : lineOld,
            lineNew: type === 'del' ? '' : lineNew,
            type,
          });
          if (type !== 'add') lineOld++;
          if (type !== 'del') lineNew++;
        }
        i++;
      }
      blocks.push({ type: 'change', lines: change });
    }
  }

  // Now emit with context
  const summarized = [];

  for (let j = 0; j < blocks.length; j++) {
    const block = blocks[j];

    if (block.type === 'change') {
      // Add leading context
      const leading = (j > 0 && blocks[j - 1].type === 'context')
        ? blocks[j - 1].lines.slice(-context)
        : [];

      const trailing = (j < blocks.length - 1 && blocks[j + 1].type === 'context')
        ? blocks[j + 1].lines.slice(0, context)
        : [];

      // Push leading context
      for (const l of leading) {
        summarized.push({
          line: l.line,
          lineOld: l.lineOld,
          lineNew: l.lineNew,
          type: 'context',
        });
      }

      // Push change lines
      for (const l of block.lines) {
        summarized.push(l);
      }

      // Push trailing context
      for (const l of trailing) {
        summarized.push({
          line: l.line,
          lineOld: l.lineOld,
          lineNew: l.lineNew,
          type: 'context',
        });
      }

      // Remove consumed context from next context block
      if (j < blocks.length - 1 && blocks[j + 1].type === 'context') {
        blocks[j + 1].lines = blocks[j + 1].lines.slice(context);
      }
    }
  }

  return summarized;
}
const readLines = async (filePath) => {
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    return data
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const mergeLines = async (existingFilepath, filepath2) => {
  let e = await exists(existingFilepath)
  if (e) {
    // exists. merge
    console.log(existingFilepath, "exists. merge")
    const existing = await readLines(existingFilepath)
    const other = await readLines(filepath2);
    const merged = [...new Set([...existing, ...other])].sort().join('\n') + '\n';

    let current = await fs.promises.readFile(existingFilepath, "utf8")
    if (current.trim() !== merged.trim()) {
      //console.log("merged has changed")
      // changed
      await fs.promises.writeFile(existingFilepath, merged)
    } else {
      //console.log(" no changes needed")
    }
  } else {
    // does not exist, just copy 
    console.log(existingFilepath, "does not exist. copy")
    await fs.promises.cp(filepath2, existingFilepath)
  }
  
}

const ignore_subrepos = async (root_path, repos) => {
  /*
  repos [
    {
      name: 'facefusion-pinokio.git',
      gitPath: '/Users/x/pinokio/api/facefusion-pinokio.git/.git',
      gitRelPath: '.git',
      gitParentPath: '/Users/x/pinokio/api/facefusion-pinokio.git',
      gitParentRelPath: 'facefusion-pinokio.git',
      dir: '/Users/x/pinokio/api/facefusion-pinokio.git',
      url: 'https://github.com/facefusion/facefusion-pinokio.git'
    },
    {
      name: 'facefusion-pinokio.git/facefusion',
      gitPath: '/Users/x/pinokio/api/facefusion-pinokio.git/facefusion/.git',
      gitRelPath: 'facefusion/.git',
      gitParentPath: '/Users/x/pinokio/api/facefusion-pinokio.git/facefusion',
      gitParentRelPath: 'facefusion-pinokio.git/facefusion',
      dir: '/Users/x/pinokio/api/facefusion-pinokio.git/facefusion',
      url: 'https://github.com/facefusion/facefusion'
    }
  ]
  */
  /*
  repo_paths = [
    '/facefusion-pinokio.git/'
    '/facefusion-pinokio.git/facefusion/'
  ]
  */
  let repo_paths = repos.filter((r) => {
    return r.gitParentPath !== root_path
  }).map((r) => {
    return "/" + path.relative(root_path, r.gitParentPath) + "/"
  })

  let gitignore = path.resolve(root_path, ".gitignore")
  let e = await exists(gitignore)
  if (e) {

    let lines = [];
    let content
    try {
      content = await fs.promises.readFile(gitignore, "utf8");
      lines = content.split(/\r?\n/);
    } catch (err) {
    }
//      if (err.code !== "ENOENT") throw err; // ignore missing file, throw others
    

    if (content) {
      const trimmedLines = lines.map(line => line.trim());
      const missingRepos = repo_paths.filter(repo => !trimmedLines.includes(repo));
      if (missingRepos.length > 0) {
        const textToAppend = (content.endsWith("\n") ? "" : "\n") + missingRepos.join("\n") + "\n";
        await fs.promises.appendFile(gitignore, textToAppend, "utf8");
      }
    }
  } else {
    // does not exist, don't do anything yet
  }


}
const rewrite_localhost= (kernel, obj, source) => {

  let sourceUrl = new URL("http://" + source.host)
  // if the source host is localhost, don't do anything
  if (sourceUrl.hostname === "localhost" || sourceUrl.hostname === "127.0.0.1") {
    return obj
  }


  let protocol = source.protocol
  let sourceHost = source.host

  console.log("rewrite_localhost", { protocol, sourceHost, })

  let sourceIp
  let sourcePort
  if (protocol === "http") {
    sourceIp = sourceUrl.hostname
    sourcePort = sourceUrl.port
  } else if (protocol === "https") {
  }

  // find the 

  const fix = (url) => {
    console.log("Fix url", url)
    /*
    url:
      http://localhost:8188
      http://127.0.0.1:8188

      => https://8188.localhost
      => http://192.168.1.48:42001
    */
    try {
      const u = new URL(url);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        let port = u.port
        let hostname = u.hostname
        let host = u.host
        console.log({ port, hostname, host })
        if (protocol === "https") {
          let proxyDomain
          for(let item of kernel.peer.info[kernel.peer.host].router_info) {
            if (String(item.internal_port) === String(port)) {
              if (item.external_router && item.external_router.length > 0) {
                proxyDomain = item.external_router[0]
              }
              break;
            }
          }
          if (proxyDomain) {
            u.host = proxyDomain
            u.port = ""
            u.protocol = "https"
          }
        } else {
          let proxyPort = kernel.peer.info[kernel.peer.host].port_mapping["" + port]
          u.hostname = sourceIp;
          u.port = proxyPort;
        }
        return u.toString();
      }
    } catch (e) {
      console.log("ERROR", e)
      
    }
    return url;
  };

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "href" && typeof v === "string" &&
          (v.startsWith("http://localhost") || v.startsWith("http://127.0.0.1"))) {
        node[k] = fix(v);
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  };

  walk(obj);
  return obj;
}


module.exports = {
  parse_env, log_path, api_path, api_name, update_env, parse_env_detail, openfs, port_running, du, is_port_available, find_python, find_venv, fill_object, run, openURL, u2p, p2u, log, diffLinesWithContext, classifyChange, push, filepicker, exists, clipboard, mergeLines, ignore_subrepos, rewrite_localhost, symlink, file_type
}
