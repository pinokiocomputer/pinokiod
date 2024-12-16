const fs = require('fs')
const os = require('os')
const net = require('node:net')
const path = require('path')
const dotenv = require('dotenv')
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
  console.time("disk size calc")
  let totalSize = await getFolderSizeBin(folderpath)
  console.timeEnd("disk size calc")
  console.log("totalSize", totalSize)
  return totalSize;
}
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
const openfs = (dirPath, options) => {
  let command = '';
  const platform = os.platform()
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
module.exports = {
  parse_env, log_path, api_path, update_env, parse_env_detail, openfs, port_running, du
}
