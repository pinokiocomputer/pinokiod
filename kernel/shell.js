const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require("xterm-addon-serialize");
const sanitize = require("sanitize-filename");
const YAML = require('yaml')
const kill = require('kill-sync')
const fastq = require('fastq')
const normalize = require('normalize-path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs');
//const pty = require('node-pty-prebuilt-multiarch-cp');
//const pty = require('@cocktailpeanut/node-pty-prebuilt-multiarch')
const pty = require('@homebridge/node-pty-prebuilt-multiarch')
const path = require("path")
const sudo = require("sudo-prompt-programfiles-x86");
const unparse = require('yargs-unparser-custom-flag');
const Util = require('./util')
const Environment = require('./environment')
const ShellParser = require('./shell_parser')
const AnsiStreamTracker = require('./ansi_stream_tracker')
const home = os.homedir()

// xterm.js currently ignores DECSYNCTERM (CSI ? 2026 h/l) and renders it as text on Windows.
// filterDecsync() removes these sequences so they do not pollute the terminal output.
class Shell {
  /*
    params 
    req := {
      uri: <root uri>,
      method,
      params: {
        id,
        path,
        env
      }
    }
  */
  constructor(kernel) {
    this.EOL = os.EOL
    this.kernel = kernel
    this.platform = os.platform()
    this.logs = {}
    this.shell = this.platform === 'win32' ? 'cmd.exe' : 'bash';
    this.supportsBracketedPaste = this.computeBracketedPasteSupport(this.shell)
    if (this.kernel && this.kernel.bracketedPasteSupport) {
      const cached = this.kernel.bracketedPasteSupport[(this.shell || '').toLowerCase()]
      if (typeof cached === 'boolean') {
        this.supportsBracketedPaste = cached
      }
    }
    this.decsyncBuffer = ''
    this.nudgeRestoreTimer = null
    this.nudging = false
    this.nudgeReleaseTimer = null
    this.lastInputAt = 0
    this.canNudge = true
    this.enableNudge = false
    this.awaitingIdleNudge = false
    this.idleNudgeTimer = null
    this.idleNudgeDelay = 100
    this.ignoreNudgeOutput = false
    this.userActive = false
    this.userActiveTimer = null
    this.userActiveTimeout = 1000
    this.ansiTracker = new AnsiStreamTracker()

    // Windows: /D => ignore AutoRun Registry Key
    // Others: --noprofile => ignore .bash_profile, --norc => ignore .bashrc
    this.args = this.platform === 'win32' ? ["/D"] : ["--noprofile", "--norc"]

    //this.vt = new Terminal({ allowProposedApi: true, scrollback: 5, })
    // this.vt = new Terminal({
    //     allowProposedApi: true,
    //     cols: 200,
    //     rows: 30,

    // })
    // this.vts = new SerializeAddon()
    // this.vt.loadAddon(this.vts)
    this.checkpoint = {
      on: [],
      sequence: [],
      serialized: 0
    }
    this.queue = fastq((data, cb) => {
      this.stream(data, cb)
    }, 1)

  }
  async init_env(params) {
    this.env = Object.assign({}, process.env)
    // If the user has set PYTHONPATH, unset it.
    if (this.env.PYTHONPATH) {
      delete this.env.PYTHONPATH
    }

    if (this.env.CMAKE_MAKE_PROGRAM) {
      delete this.env.CMAKE_MAKE_PROGRAM
    }

    if (this.env.CMAKE_GENERATOR) {
      delete this.env.CMAKE_GENERATOR
    }

    //this.env.PNPM_CONFIG_PREFIX = this.kernel.path("bin/npm")
    //this.env.pnpm_config_prefix = this.kernel.path("bin/npm")
//    this.env.PNPM_HOME = this.kernel.path("bin/npm")
//    this.env.pnpm_home = this.kernel.path("bin/npm")

//    this.env.NPM_CONFIG_PREFIX = this.kernel.path("bin/npm")
//    this.env.npm_config_prefix = this.kernel.path("bin/npm")

    
//    if (this.env.CUDA_HOME) {
//      delete this.env.CUDA_HOME
//    }
    for(let key in this.env) {
      if (key.startsWith("CUDA")) {
        delete this.env[key]
      }
      if (/.*(SSH|SSL).*/.test(key)) {
        delete this.env[key]
      }
    }

    this.env.CONDA_SHORTCUTS = 0
    this.env.CONDA_CONSOLE = 'json'

    if (this.platform === "win32") {
      this.env.npm_config_symlink = "false"
    }

//    this.env.TCELL_MINIMIZE=1
    this.env.CMAKE_OBJECT_PATH_MAX = 1024
    this.env.PYTORCH_ENABLE_MPS_FALLBACK = 1
    this.env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD = 1
    //this.env.NODE_EXTRA_CA_CERTS = this.kernel.path("cache/XDG_DATA_HOME/caddy/pki/authorities/local/root.crt")
//    this.env.PIP_REQUIRE_VIRTUALENV = "true"
//    this.env.NPM_CONFIG_USERCONFIG = this.kernel.path("user_npmrc")
//    this.env.NPM_CONFIG_GLOBALCONFIG = this.kernel.path("global_npmrc")
//    this.env.npm_config_userconfig = this.kernel.path("user_npmrc")
//    this.env.npm_config_globalconfig = this.kernel.path("global_npmrc")

    // First override this.env with system env
    let system_env = await Environment.get(this.kernel.homedir, this.kernel)
    this.env = Object.assign(this.env, system_env)

    let hf_keys = await this.kernel.connect.keys("huggingface")
    if (hf_keys && hf_keys.access_token) {
      this.env.HF_TOKEN = hf_keys.access_token
    }

    // if the shell is running from a script file, the params.$parent will include the path to the parent script
    // this means we need to apply app environment as well
    if (params.$parent) {
      let api_path
      if (params.$parent.cwd) {
        api_path = Util.api_path(params.$parent.cwd, this.kernel)
      } else {
        api_path = Util.api_path(params.$parent.path, this.kernel)
      }

      // initialize folders
      await Environment.init_folders(api_path, this.kernel)

      // apply app env to this.env
      let app_env = await Environment.get(api_path, this.kernel)
      this.env = Object.assign(this.env, app_env)
    }
    let PATH_KEY = Object.keys(this.env).find((key) => key.toLowerCase() === "path") || "PATH";
    if (!this.env[PATH_KEY]) {
      // fall back to whichever casing exists so we don't end up writing to an undefined key
      this.env[PATH_KEY] = this.env.Path || this.env.PATH || this.env.path;
    }
    if (this.shell === "cmd.exe") {
      // ignore 
    } else {
      this.env[PATH_KEY]= this.kernel.shellpath || [
        './node_modules/.bin',
        '/.nodebrew/current/bin',
        '/usr/local/bin',
        this.env[PATH_KEY]
      ].join(':');
    }

    if (this.platform === "linux") {
      let gxx = this.kernel.which('g++')
      if (gxx) {
        this.env.NVCC_PREPEND_FLAGS = `-ccbin ${gxx}`
      }
    }

    this.env[PATH_KEY] = this.env[PATH_KEY] + path.delimiter + path.resolve(this.kernel.homedir, 'bin')


    if (params.env) {
      for(let key in params.env) {
        // iterate through the env attributes
        let val = params.env[key]
        if (key.toLowerCase() === "path") {
          // "path" is a special case => merge with process.env.PATH
          if (params.env.path) {
            this.env[PATH_KEY] = `${params.env.path.join(path.delimiter)}${path.delimiter}${this.env[PATH_KEY]}`.replaceAll('"', '')
            //this.env.PINOKIO_PATH = params.env.path.join(path.delimiter)
            //this.env[PATH_KEY] = `$PINOKIO_PATH${path.delimiter}${this.env[PATH_KEY]}`
          }
          if (params.env.PATH) {
            this.env[PATH_KEY] = `${params.env.PATH.join(path.delimiter)}${path.delimiter}${this.env[PATH_KEY]}`.replaceAll('"', '')
            //this.env.PINOKIO_PATH = params.env.PATH.join(path.delimiter)
            //this.env[PATH_KEY] = `$PINOKIO_PATH${path.delimiter}${this.env[PATH_KEY]}`
          }
          if (params.env.Path) {
            this.env[PATH_KEY] = `${params.env.Path.join(path.delimiter)}${path.delimiter}${this.env[PATH_KEY]}`.replaceAll('"', '')
            //this.env.PINOKIO_PATH = params.env.Path.join(path.delimiter)
            //this.env[PATH_KEY] = `$PINOKIO_PATH${path.delimiter}${this.env[PATH_KEY]}`
          }
        } else if (Array.isArray(val)) {
          if (this.env[key]) {
            this.env[key] = `${val.join(path.delimiter)}${path.delimiter}${this.env[key]}`
          } else {
            this.env[key] = `${val.join(path.delimiter)}`
          }
        } else {
          // for the rest of attributes, simply set the values
          this.env[key] = params.env[key]
        }
      }
    }
    for(let key in this.env) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) && key !== "ProgramFiles(x86)") {
        delete this.env[key]
      }
      let val = this.env[key]
      if (/[\r\n]/.test(val)) {
        const replaced = val.replaceAll(/[\r\n]+/g, ' ');
        this.env[key] = replaced
//        delete this.env[key]
      }
    }


    if (params["-env"] && Array.isArray(params["-env"])) {
      for(let key of params["-env"]) {
        delete this.env[key]
      }
    }
  }
  async start(params, ondata) {
    this.ondata = ondata
    if (this.nudgeRestoreTimer) {
      clearTimeout(this.nudgeRestoreTimer)
      this.nudgeRestoreTimer = null
    }
    if (this.nudgeReleaseTimer) {
      clearTimeout(this.nudgeReleaseTimer)
      this.nudgeReleaseTimer = null
    }
    this.cancelIdleNudge()
    this.nudging = false
    this.lastInputAt = 0
    this.canNudge = true
    this.ignoreNudgeOutput = false
    if (this.userActiveTimer) {
      clearTimeout(this.userActiveTimer)
      this.userActiveTimer = null
    }
    this.userActive = false
    this.decsyncBuffer = ''

    /*
      params := {
        group: <group id>,
        id: <shell id>,
        path: <shell cwd (always absolute path)>,
        env: <environment value key pairs>
      }
    */

    this.kill_messages = params.kill

    this.cols = 100
    this.rows = 30

    if (params.cols) {
      this.cols = params.cols
    }
    if (params.rows) {
      this.rows = params.rows
    }
    if (params.client && params.client.cols) {
      this.cols = params.client.cols
    }
    if (params.client && params.client.rows) {
      this.rows = params.client.rows
    }

    this.vt = new Terminal({
      allowProposedApi: true,
      cols: this.cols,
      rows: this.rows,
    })
    this.vts = new SerializeAddon()
    this.vt.loadAddon(this.vts)

    // 1. id
    this.id = (params.id ? params.id : uuidv4())

    // 2. group id
    this.group = params.group

    // 2. env
    // default env
    await this.init_env(params)


    this.ondata({ raw: `\r\n████\r\n██ Starting Shell ${this.id}\r\n` })

    this.start_time = Date.now()
    this.params = params
    this.EOL = os.EOL
    if (this.params.shell) {
      this.shell = this.params.shell
      const normalizedShell = (this.shell || '').toLowerCase()
      if (this.kernel && this.kernel.bracketedPasteSupport && typeof this.kernel.bracketedPasteSupport[normalizedShell] === 'boolean') {
        this.supportsBracketedPaste = this.kernel.bracketedPasteSupport[normalizedShell]
      } else {
        this.supportsBracketedPaste = this.computeBracketedPasteSupport(this.shell)
      }
      if (/bash/i.test(this.shell)) {
        this.args = ["--noprofile", "--norc"]
        //this.args = [ "--login", "-i"]
        this.EOL = "\n"
        //if (this.platform === "win32") {
        //  console.log("before transform this.env", this.env)
        //  for(let key in this.env) {
        //    let val = this.env[key]
        //    if (val && typeof val === "string") {
        //      // split with ;
        //      let chunks = val.split(";")
        //      let transformed_chunks = []
        //      for(let chunk of chunks) {
        //        if (path.isAbsolute(chunk)) {
        //          let transformed = :normalize(chunk) 
        //          transformed = "/" + transformed.replace(":", "")
        //          transformed_chunks.push(transformed)
        //        } else {
        //          transformed_chunks.push(chunk)
        //        }
        //      }
        //      this.env[key] = transformed_chunks.join(";")
        //    }
        //  }
        //  console.log("after transform this.env", this.env)
        //}
      }
    }

    // 3. path => path can be http, relative, absolute
    this.path = params.path

    // automatically add self to the shells registry
    this.kernel.shell.add(this)


    if (params.sudo) {
      let options = {
        name: "Pinokio",
//        env: {}
//        icns: '/Applications/Electron.app/Contents/Resources/Electron.icns', // (optional)
      };

//      for(let key in this.env) {
//        options.env[key] = String(this.env[key])
//      }

      // sudo-prompt uses TEMP
      await fs.promises.mkdir(this.env.TEMP, { recursive: true }).catch((e) => { })
      let response = await new Promise((resolve, reject) => {
        params.message = this.build({ message: params.message })
        if (ondata) ondata({ id: this.id, raw: params.message + "\r\n" })

        // Modify process.env (and need to immediately revert it back to original process.env so as to not affect other logic)
        let old_env = process.env
        process.env = this.env
        sudo.exec(params.message, options, (err, stdout, stderr) => {
          if (err) {
            console.log("SUDOPROMPT ERR", err)
            // even when there's an error, just log the error, and don't throw the error. Instead, print the stdout so it displays what happened
            resolve(stdout)
//            reject(err)
          } else if (stderr) {
            console.log("SUDOPROMPT STDERR", stderr)
            resolve(stdout)
//            reject(stderr)
          } else {
            resolve(stdout)
          }
        });

        // Immediately revert env back to original
        process.env = old_env
      })
      if (ondata) ondata({
        id: this.id,
        raw: response.replaceAll("\n", "\r\n")
      })
      return response
    } else {
      let response = await this.request(params, async (stream) => {
        if (ondata) ondata(stream)
//        if (stream.prompt) {
//          this.resolve()
//        } else {
//          if (ondata) ondata(stream)
//        }
      })
      return response
    }

//    return this.id
  }
  resize({ cols, rows }) {
//    console.log("RESIZE", { cols, rows })
    this.cols = cols
    this.rows = rows
    this.ptyProcess.resize(cols, rows)
    this.vt.resize(cols, rows)
  }
  async emit2(message) {
    /*
    // buffer size
    1. default:256
    2. "interactive": true => 1024
    3. "buffer": n => n
    */
    let chunk_size = 256  // default buffer: 256
    if (this.params && this.params.buffer) {
      chunk_size = this.params.buffer 
    } else if (this.params.interactive) {
      chunk_size = 1024
    }
//    console.log({ interactive: this.params.interactive, chunk_size })
    this.canNudge = true
    this.cancelIdleNudge()
    for(let i=0; i<message.length; i+=chunk_size) {
      let chunk = message.slice(i, i+chunk_size)
//      console.log("write chunk", { i, chunk })
      this.ptyProcess.write(chunk)
      this.ondata({ i, total: message.length, type: "emit2" })
      await new Promise(r => setTimeout(r, 10));
//      if (interactive) {
//        await new Promise(queueMicrotask); // zero-delay yield to avoid blocking
//      } else {
//        await new Promise(r => setTimeout(r, 1));
//      }
    }
  }
  emit(message) {
    if (this.input) {
      if (this.ptyProcess) {
        if (message.length > 1024) {
          this.lastInputAt = Date.now()
          this.canNudge = true
          this.cancelIdleNudge()
          this.emit2(message)
        } else {
          this.ptyProcess.write(message)
          this.lastInputAt = Date.now()
          this.canNudge = true
          this.cancelIdleNudge()
        }
      }
    }
  }
  send(message, newline, cb) {
    if (this.ptyProcess) {
      this.cb = cb
      return new Promise((resolve, reject) => {
        this.resolve = resolve
        if (Array.isArray(message)) {
          for(let m of message) {
            this.cmd = this.build({ message: m })
            this.ptyProcess.write(this.cmd)
            this.lastInputAt = Date.now()
            this.canNudge = true
            this.cancelIdleNudge()
            if (newline) {
              this.ptyProcess.write(this.EOL)
              this.lastInputAt = Date.now()
              this.canNudge = true
              this.cancelIdleNudge()
            }
          }
        } else {
          this.cmd = this.build({ message })
          this.ptyProcess.write(this.cmd)
          this.lastInputAt = Date.now()
          this.canNudge = true
          this.cancelIdleNudge()
          if (newline) {
            this.ptyProcess.write(this.EOL)
            this.lastInputAt = Date.now()
            this.canNudge = true
            this.cancelIdleNudge()
          }
        }
      })
    }
  }
  enter(message, cb) {
    if (this.ptyProcess) {
      this.cb = cb
      return new Promise((resolve, reject) => {
        this.resolve = resolve
        if (Array.isArray(message)) {
          for(let m of message) {
            this.cmd = this.build({ message: m })
            this.ptyProcess.write(this.cmd)
            this.ptyProcess.write(this.EOL)
            this.lastInputAt = Date.now()
            this.canNudge = true
            this.cancelIdleNudge()
          }
        } else {
          this.cmd = this.build({ message })
          this.ptyProcess.write(this.cmd)
          this.ptyProcess.write(this.EOL)
          this.lastInputAt = Date.now()
          this.canNudge = true
          this.cancelIdleNudge()
        }
      })
    }
  }
  write(message, cb) {
    if (this.ptyProcess) {
      this.cb = cb
      return new Promise((resolve, reject) => {
        this.resolve = resolve
        this.cmd = this.build({ message })
        this.ptyProcess.write(this.cmd)
        this.lastInputAt = Date.now()
        this.canNudge = true
        this.cancelIdleNudge()
      })
    }
  }
  clear() {
    let buf = this.vts.serialize()
    let cleaned = this.stripAnsi(buf)

    // Log before resolving
    this._log(buf, cleaned)
    if (this.shell === 'cmd.exe') {
      // For Windows
      this.vt.write('\x1Bc');
      //this.ptyProcess.write('cls\n');
    } else {
      // For Unix-like systems (Linux, macOS)
      this.vt.write('\x1B[2J\x1B[3J\x1B[H');
      //this.ptyProcess.write('clear\n')
    }
  }
  async run(params, cb) {
    let r = await this.request(params, cb)
    return r
  }
  async request(params, cb) {
    // create the path if it doesn't exist
    await fs.promises.mkdir(params.path, { recursive: true }).catch((e) => { })


    // not connected => make a new connection => which means get a new prompt
    // if already connected => no need for a new prompt
    if (params.input) {
      this.input = params.input
    }
    if (params.persistent) {
      this.persistent = params.persistent
    }
    this.prompt_pattern = await this.prompt(params.path)
    this.cb = cb
    let r = await this.exec(params)
    return r
  }
  respond(data) {
    this.clear()
    this.resolve(data)
    this.cb  = undefined // clean up cb so that it doesn't get triggered anymore
    this.resolve = undefined
  }
  // get the prompt => used to detec when the process ends (even when there is no clean exit)
  prompt(cwd) {
    return new Promise((resolve, reject) => {
      const config = {
        name: 'xterm-color',
        cols: 1000,
        rows: Math.max(this.rows || 24, 24),
        //cols: 1000,
        //rows: 30,
      }
      if (cwd) {
        config.cwd = path.resolve(cwd)
      }
      config.env = this.env
      //let re = /(.+\r\n)(\1)/gs

      //let re = /([\r\n]+[^\r\n]+)(\1)/gs
      let re = /(.+)(\1)/gs
      let term = pty.spawn(this.shell, this.args, config)
      let vt = new Terminal({
        allowProposedApi: true
      })
      let vts = new SerializeAddon()
      vt.loadAddon(vts)

      let queue = fastq((data, cb) => {
        if (this.prompt_ready) {
          vt.write(data, () => {
            let buf = vts.serialize()
            let re = /(.+)echo pinokio[\r\n]+pinokio[\r\n]+(\1)/gs
            const match = re.exec(buf)
            if (match && match.length > 0) {
              this.prompt_ready = false
              this.prompt_done = true
              let stripped = this.stripAnsi(match[1])
              const p = stripped
                .replaceAll(/[\r\n]/g, "")
                .trim()
                .replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
              term.kill()
              vt.dispose()
              queue.killAndDrain()
              resolve(p)
            }
          })
          cb()
        }
      }, 1)
      term.onData((data) => {
        if (!this.prompt_done) {
          if (this.prompt_ready) {
            queue.push(this.filterDecsync(data))
          } else {
            setTimeout(() => {
              if (!this.prompt_ready) {
                this.prompt_ready = true
                term.write(`echo pinokio${this.EOL}echo pinokio${this.EOL}`)
              }
            }, 500)
          }
        }
      });
    })
  }
  stripAnsi (str) {
    const pattern = [
      '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-Za-z=><~]))'
    ].join('|');
    const regex = new RegExp(pattern, 'gi')
    return str.replaceAll(regex, '');
  }
  computeBracketedPasteSupport(shellName) {
    const name = (shellName || '').toLowerCase()
    if (!name) {
      return true
    }
    if (name.includes('cmd.exe') || name === 'cmd') {
      return false
    }
    if (name.includes('powershell') || name.includes('pwsh')) {
      return false
    }
    return true
  }
  exists(abspath) {
    return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
  }
  build (params) {
    if (params.message) {
      if (typeof params.message === "string") {
        return params.message
//        // raw string -> do not touch
//        if (this.platform === "win32") {
//          delimiter = " & ";
//        } else {
//          delimiter = " ; ";
//        }
//        let m = params.message + delimiter + `echo "FINISHED: ${params.message}"\r\n`
//        return m
      } else if (Array.isArray(params.message)) {
//        params.message.push(`echo "SHELL FINISHED RUNNING"\r\n`)
        // if params.message is empty, filter out
        //let delimiter = " && "
        let delimiter
        if (this.shell === "cmd.exe") {
          if (params.chain) {
            if (params.chain === "&") {
              delimiter = " && ";   // stop if one command in the chain fails
            } else if (params.chain === "|") {
              delimiter = " || ";   // only run the rest of the chain if a command fails
            } else if (params.chain === "*") {
              delimiter = " & ";   // always run all commands regardless of whether a command fails
            } else {
              // exception => use the safe option (stop when command fails)
              delimiter = " && "; // must use &&. & doesn't necessariliy wait until the curruent command finishes
            }
          } else {
            // default
            delimiter = " && "; // must use &&. & doesn't necessariliy wait until the curruent command finishes
          }
        } else {
          if (params.chain) {
            if (params.chain === "&") {
              delimiter = " && ";   // stop if one command in the chain fails
            } else if (params.chain === "|") {
              delimiter = " || ";   // only run the rest of the chain if a command fails
            } else if (params.chain === "*") {
              delimiter = " ; ";   // always run all commands regardless of whether a command fails
            } else {
              // exception => use the safe option (stop when command fails)
              delimiter = " && "; // must use &&. & doesn't necessariliy wait until the curruent command finishes
            }
          } else {
            // default
            delimiter = " && "; // must use &&. & doesn't necessariliy wait until the curruent command finishes
          }
        }
        return params.message.filter((m) => {
          return m && !/^\s+$/.test(m)
        }).join(delimiter)
        //return params.message.join(" && ")
      } else {
        // command line message
        let chunks = unparse(params.message).map((item) => {
          let tokens = item.split(" ")
          if (tokens.length > 1) {
            return `"${item}"`
          } else {
            return item
          }
        })
        return `${chunks.join(" ")}`
      }
    } else {
      return ""
    }
  }
  conda_hook () {
    if (this.platform === "win32") {
      if (/bash/i.test(this.shell)) {
        return "source /c/pinokio/bin/miniconda/etc/profile.d/conda.sh"
      } else {
        return "conda_hook"
      }
    } else {
      return `eval "$(conda shell.bash hook)"`
    }
  }
  async activate(params) {

    // conda and venv can coexist
    // 1. first process conda
    //    - if conda is not specified => base => no need to create
    //    - if conda is specified
    //      - if string => the string is the path => create if doesn't exist yet
    //      - if object => the conda.path is the path => create if doesn't exist yet
    // 2. then process venv

    const isNumber = (value) => {
      return !isNaN(Number(value)) && isFinite(Number(value));
    }


    // 1. conda
    let conda_path
    let conda_name
    let conda_python = "python=3.10"
    let conda_args
    let conda_activate

    if (params.conda) {

      conda_args = params.conda.args

      // 1. conda_path/conda_name/conda_python
      if (typeof params.conda === "string") {
        // params.conda => interpret as path
        conda_path = params.conda
      } else {
        // params.conda.skip
        if (params.conda.skip) {
          // do nothing
        } else {
          if (typeof params.conda === "string") {
            conda_path = params.conda
          } else {
            // conda_path
            if (params.conda.path) {
              conda_path = params.conda.path
            } else if (params.conda.name) {
              conda_name = params.conda.name
            } else {
              throw new Error("when specifying conda as an object, the conda.name or conda.path must exist")
            }

            if (params.conda.activate) conda_activate = params.conda.activate

            // conda_python
            if (params.conda.python) {
              if (isNumber(params.conda.python)) {
                conda_python = "python=" + params.conda.python
              } else {
                conda_python = params.conda.python
              }
            } else if (params.conda_python) {
              if (isNumber(params.conda_python)) {
                conda_python = "python=" + params.conda_python
              } else {
                conda_python = params.conda_python
              }
            }
          }
        }
      }
    } else {
      conda_name = "base"
    }


    // 2. conda_activation

    let timeout
    if (this.shell === "cmd.exe") {
      timeout = 'C:\\Windows\\System32\\timeout /t 1 > nul'
    } else {
      //timeout = "sleep '1'"
      timeout = '/usr/bin/sleep 1'
    }


    let conda_hook = this.conda_hook()
    let conda_activation = []
    if (conda_activate) {
      if (typeof conda_activate === "string") {
        if (conda_activate === "minimal") {
          conda_activation = [
            conda_hook,
            'conda activate base',
          ]
        }
      } else if (Array.isArray(conda_activate)) {
        conda_activation = conda_activate
      }
    } else if (conda_path) {
      let env_path = path.resolve(params.path, conda_path)
      let env_exists = await this.exists(env_path)
      if (env_exists) {
        conda_activation = [
          conda_hook,
//          timeout,
          `conda deactivate`,
          `conda deactivate`,
          `conda deactivate`,
//          timeout,
          `conda activate ${env_path}`,
//          timeout,
        ]
      } else {
        conda_activation = [
          conda_hook,
//          timeout,
          `conda create -y -p ${env_path} ${conda_python} ${conda_args ? conda_args : ''}`,
          `conda deactivate`,
          `conda deactivate`,
          `conda deactivate`,
//          timeout,
          `conda activate ${env_path}`,
//          timeout,
        ]
      }
    } else if (conda_name) {
      if (conda_name === "base") {
        conda_activation = [
          conda_hook,
//          timeout,
          `conda deactivate`,
          `conda deactivate`,
          `conda deactivate`,
//          timeout,
          `conda activate ${conda_name}`,
//          timeout,
        ]
      } else {
        let envs_path = this.kernel.bin.path("miniconda/envs")
        let env_path = path.resolve(envs_path, conda_name)
        let env_exists = await this.exists(env_path)
        if (env_exists) {
          conda_activation = [
            conda_hook,
//            timeout,
            `conda deactivate`,
            `conda deactivate`,
            `conda deactivate`,
//            timeout,
            `conda activate ${conda_name}`,
//            timeout,
          ]
        } else {
          conda_activation = [
            conda_hook,
            `conda create -y -n ${conda_name} ${conda_python} ${conda_args ? conda_args : ''}`,
            `conda deactivate`,
            `conda deactivate`,
            `conda deactivate`,
//            timeout,
            `conda activate ${conda_name}`,
//            timeout,
          ]
        }
      }
    } else {
      // no conda name or conda path => means don't activate any env
      conda_activation = []
    }

    // Visual Studio Build Tools (Exception)
    // only add conda env if conda exists
//    if (conda_activation.length > 0) {
//      const vs_path_env = this.kernel.bin.vs_path_env
//      console.log({ vs_path_env })
//      if (vs_path_env && vs_path_env.PATH) {
//        const vs = `conda env config vars set PATH=${vs_path_env.PATH.join(path.delimiter)}${path.delimiter}%PATH%`
//        console.log({ vs })
//        conda_activation.push(vs)
//      }
//    }

    /*
      ONLY inject vcvarsall if "build": true

      {
        method,
        params,
        build: true
      }
    */
    if (params.build) {
      if (this.platform === "win32") {
        try {
          const vcvars_path = this.kernel.bin.vs_path_env && this.kernel.bin.vs_path_env.VCVARSALL_PATH
          const architecture = os.arch().toLowerCase();  // 'x64', 'ia32' (32-bit), etc.
          const armArchitecture = process.arch.toLowerCase(); // For ARM-based architectures (on Windows), process.arch might be 'arm64', 'arm', etc.

          // Map architectures to vcvarsall.bat argument
          let arg
          if (architecture === 'x64' || armArchitecture === 'arm64') {
            //arg = 'amd64';  // Native 64-bit architecture
            arg = 'x64';
          } else if (architecture === 'ia32' || armArchitecture === 'arm') {
            arg = 'x86';    // Native 32-bit architecture
          } else if (armArchitecture === 'x86_arm64') {
            arg = 'x86_arm64';  // ARM64 on x86
          } else if (armArchitecture === 'x86_arm') {
            arg = 'x86_arm';    // ARM on x86
          } else if (armArchitecture === 'amd64_arm64') {
            arg = 'amd64_arm64'; // ARM64 on x64
          } else if (armArchitecture === 'amd64_arm') {
            arg = 'amd64_arm';   // ARM on x64
          } else {
            console.log(`Unsupported arch: os.arch()=${architecture}, process.arch=${armArchitecture}`)
          }

          const activate_root = this.kernel.bin.path("miniconda/etc/conda/activate.d")
          const logDir = this.kernel.path("cache", "logs")
          await fs.promises.mkdir(logDir, { recursive: true }).catch(() => {})
          const logSuffix = this.id || Date.now()
          const compiler_log = path.resolve(logDir, `vs-${logSuffix}.log`)
          const cuda_log = path.resolve(logDir, `cuda-${logSuffix}.log`)
          const compiler_candidates = [
            path.resolve(activate_root, "pinokio", "vs2019_compiler_vars.bat"),
            path.resolve(activate_root, "pinokio", "vs2022_compiler_vars.bat"),
            path.resolve(activate_root, "vs2019_compiler_vars.bat"),
            path.resolve(activate_root, "vs2022_compiler_vars.bat"),
          ]
          let compiler_script = null
          for (const candidate of compiler_candidates) {
            if (await this.exists(candidate)) {
              compiler_script = candidate
              break
            }
          }
          if (compiler_script) {
            conda_activation.push(`CALL "${compiler_script}" > "${compiler_log}" 2>&1`)
          } else if (vcvars_path && arg) {
            conda_activation.push(`CALL "${vcvars_path}" ${arg} > "${compiler_log}" 2>&1`)
          }
          const cuda_candidates = [
            path.resolve(activate_root, "pinokio", "~cuda-nvcc_activate.bat"),
            path.resolve(activate_root, "~cuda-nvcc_activate.bat"),
          ]
          let cuda_script = null
          for (const candidate of cuda_candidates) {
            if (await this.exists(candidate)) {
              cuda_script = candidate
              break
            }
          }
          if (cuda_script) {
            conda_activation.push(`CALL "${cuda_script}" > "${cuda_log}" 2>&1`)
          }
        } catch (e) {
          console.log('vc vars setup', e)
        }
      }
    }

    // Update env setting
    if (this.env) {
//        this.env.CONDA_PIP_INTEROP_ENABLED = "1"
      this.env.CONDA_AUTO_ACTIVATE_BASE = "false"
      this.env.PYTHONNOUSERSITE = "1"
    } else {
      //this.env = { CONDA_PIP_INTEROP_ENABLED: "1", CONDA_AUTO_ACTIVATE_BASE: "false", PYTHONNOUSERSITE: "1" }
      this.env = { CONDA_AUTO_ACTIVATE_BASE: "false", PYTHONNOUSERSITE: "1" }
    }


    if (conda_name === "base") {
      this.env.PIP_REQUIRE_VIRTUALENV = "true"
    }

    this.env.UV_PYTHON_PREFERENCE="only-managed"

    // 2. venv

    /*
    {
      method: ...,
      params: ...,
      venv: <path_string>
    }

    or

    {
      method: ...,
      params: ...,
      venv: {
        path: <path_string>,
        python: <python version>
    }

    or

    {
      method: ...,
      params: ...,
      venv: <path_string>,
      venv_python: <python version>
    }

    */
    let venv_activation
    if (params.venv) {
      let env_path
      let python_version = ""
      let use_uv = false
      if (typeof params.venv === "string") {
        env_path = path.resolve(params.path, params.venv)
        if (params.venv_python) {
          python_version = ` --python ${params.venv_python}`
          use_uv = true
        }
      } else if (typeof params.venv === "object" && params.venv.path) {
        env_path = path.resolve(params.path, params.venv.path)
        if (params.venv.python) {
          python_version = ` --python ${params.venv.python}`
          use_uv = true
        }
      }
      if (env_path) {
        let activate_path = (this.platform === 'win32' ? path.resolve(env_path, "Scripts", "activate") : path.resolve(env_path, "bin", "activate"))
        let deactivate_path = (this.platform === 'win32' ? path.resolve(env_path, "Scripts", "deactivate") : "deactivate")
        let env_exists = await this.exists(env_path)
        if (env_exists) {
          if (use_uv) {
            venv_activation = [
//              `python -m venv --upgrade ${env_path}`,
//              `uv venv --allow-existing ${env_path}${python_version}`,
              (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
//              timeout,
            ]
          } else {
            venv_activation = [
//              `python -m venv --upgrade ${env_path}`,
              (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
//              timeout,
            ]
          }
        } else {
          if (use_uv) {
            // when python version is specified as venv.python => use uv
            venv_activation = [
              `uv venv ${env_path}${python_version}`,
              (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
//              `uv pip install --upgrade pip setuptools wheel`,
              deactivate_path,
//              timeout,
              (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
//              timeout,
            ]
          } else {
            // when python version is not specified, use the default python -m venv
            venv_activation = [
              `python -m venv ${env_path}`,
              (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
//              `python -m pip install --upgrade pip setuptools wheel`,
              deactivate_path,
//              timeout,
              (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
//              timeout,
            ]
          }
        }
      } else {
        venv_activation = []
      }
    } else {
      venv_activation = []
    }

    // 3. construct params.message
    let activation = conda_activation.concat(venv_activation)
    if (activation.length > 0) {
      let activation_str = this.build({
        chain: "*",
        message: activation
      })
      params.message = [activation_str].concat(params.message)
    } else {
      params.message = params.message
    }
//    params.message = conda_activation.concat(venv_activation).concat(params.message)



//    params.message = conda_activation.concat(venv_activation).concat(params.message).map((cmd) => {
//      if (this.platform === 'win32') {
//        return `call ${cmd}`
//      } else {
//        return cmd
//      }
//    })
    return params
  }
  async exec(params) {
    this.parser = new ShellParser()
    params = await this.activate(params)
    this.cmd = this.build(params)
    let res = await new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      try {
        const config = {
          name: 'xterm-color',
          //cols: 1000,
          //rows: 30,
          cols: this.cols,
          rows: this.rows,
        }
        if (params.path) {
          config.cwd = path.resolve(params.path)
        }

        config.env = this.env
        if (!this.ptyProcess) {
          // ptyProcess doesn't exist => create
          this.done = false
          this.ptyProcess = pty.spawn(this.shell, this.args, config)
          this.ptyProcess.onData((data) => {
            if (!this.monitor) {
              this.monitor = ""
            }
            this.monitor = this.monitor + data
            this.monitor = this.monitor.slice(-300) // last 300

//            let notifications = this.parser.processData(data)
//            if (notifications.length > 0) {
//              console.log({ notifications })
//              for(let notif of notifications) {
//                if (notif.type !== "bell") {
//                  Util.push({
//                    image: path.resolve(__dirname, "../server/public/pinokio-black.png"),
//                    message: notif.title,
//                    sound: true,
//                    timeout: 30,
//                  })
//                }
//              }
//            }

            if (!this.done) {

              // "request cursor position" handling: https://github.com/microsoft/node-pty/issues/535
              if (data.includes('\x1b[6n')) {
                const row = this.vt.buffer.active.cursorY + 1;
                const col = this.vt.buffer.active.cursorX + 1;
                const response = `\x1b[${row};${col}R`;
                this.ptyProcess.write(response);
                data = data.replace(/\x1b\[6n/g, ''); // remove the code
              }

              const filtered = this.filterDecsync(data)
              if (this.awaitingIdleNudge) {
                this.scheduleIdleNudge()
              }
              this.maybeNudgeForSequences(filtered)
              this.queue.push(filtered)
            }
          });
        }
      } catch (e) {
        console.log("** Error", e)
        this.kill()
      }
    })
    return res
  }
  stop(message) {
    return this.kill(message)
  }
  continue(message) {
    if (this.resolve) {
      if (message) {
        this.resolve(message)
      } else {
        let buf = this.stripAnsi(this.vts.serialize())
        this.resolve(buf)
      }
      this.resolve = undefined
      this.ondata({ raw: `\r\n\r\n██ Detached from Shell ${this.id}\r\n\r\n` })
    }
  }
  kill(message, force, cb) {

    this.done = true
    this.ready = false
    if (this.nudgeRestoreTimer) {
      clearTimeout(this.nudgeRestoreTimer)
      this.nudgeRestoreTimer = null
    }
    if (this.nudgeReleaseTimer) {
      clearTimeout(this.nudgeReleaseTimer)
      this.nudgeReleaseTimer = null
    }
    this.cancelIdleNudge()
    this.nudging = false
    this.lastInputAt = 0
    this.canNudge = true
    this.ignoreNudgeOutput = false
    if (this.userActiveTimer) {
      clearTimeout(this.userActiveTimer)
      this.userActiveTimer = null
    }
    this.userActive = false

    let buf = this.vts.serialize()
    let cleaned = this.stripAnsi(buf)

    // Log before resolving
    this._log(buf, cleaned)

    if (this.resolve) {


      if (message) {
        this.resolve(message)
      } else {
        this.resolve(cleaned)
      }
      this.resolve = undefined
    }
    this.vt.dispose()
    this.queue.killAndDrain()
//    console.log("KILL PTY", this.id)
    if (this.ptyProcess) {
      if (cb) {
        try {
          kill(this.ptyProcess.pid, "SIGKILL", true)
        } catch (e) {
          console.log("kill", this.ptyProcess.pid, e)
        }
        this.ptyProcess.kill()
        this.ptyProcess = undefined
        // automatically remove the shell from this.kernel.shells
        this.kernel.shell.rm(this.id)
        if (!this.mute) {
          this.ondata({ raw: `\r\n\r\n██ Terminated Shell ${this.id}\r\n████\r\n` })
          this.ondata({ raw: "", type: "shell.kill" })
        }
        cb()
      } else {
        try {
          kill(this.ptyProcess.pid, "SIGKILL", true)
        } catch (e) {
          console.log("kill", this.ptyProcess.pid, e)
        }
        this.ptyProcess.kill()
        this.ptyProcess = undefined
        // automatically remove the shell from this.kernel.shells
        this.kernel.shell.rm(this.id)
        if (!this.mute) {
          this.ondata({ raw: `\r\n\r\n██ Terminated Shell ${this.id}\r\n████\r\n` })
          this.ondata({ raw: "", type: "shell.kill" })
        }
      }
    } else {
      this.kernel.shell.rm(this.id)
      if (!this.mute) {
        this.ondata({ raw: `\r\n\r\n██ Terminated Shell ${this.id}\r\n████\r\n` })
        this.ondata({ raw: "", type: "shell.kill" })
      }
    }


    if (this.kernel.api.running[this.id]) {
      delete this.kernel.api.running[this.id]
    }
    if (this.kernel.memory.local[this.id]) {
      delete this.kernel.memory.local[this.id]
    }

//    this.ondata({
//      id: this.id,
//      type: "disconnect"
//    })
//    this.kernel.refresh(true)


  }
  log() {
    let buf = this.vts.serialize()
    let cleaned = this.stripAnsi(buf)
    this._log(buf, cleaned)
  }
  filterDecsync(data) {
    if (!data) return data

    const prefix = '\u001b[?2026'
    let chunk = this.decsyncBuffer ? this.decsyncBuffer + data : data
    if (chunk.includes('\u2190')) {
      chunk = chunk.replace(/\u2190/g, '\u001b')
    }
    this.decsyncBuffer = ''

    let result = ''
    let i = 0
    while (i < chunk.length) {
      if (chunk.charCodeAt(i) === 0x1b) { // ESC
        const remaining = chunk.slice(i)
        if (remaining.startsWith('\u001b[?2026h') || remaining.startsWith('\u001b[?2026l')) {
          i += 8
          continue
        }

        // Check if the remaining characters form a partial prefix of DECSYNCTERM
        let matched = 0
        const len = Math.min(prefix.length, remaining.length)
        while (matched < len && remaining[matched] === prefix[matched]) {
          matched++
        }
        if (matched === remaining.length && matched < prefix.length + 1) {
          this.decsyncBuffer = remaining
          return result
        }
      }
      result += chunk[i]
      i++
    }

    return result
  }
  setUserActive(active, ttl) {
    const clearTimer = () => {
      if (this.userActiveTimer) {
        clearTimeout(this.userActiveTimer)
        this.userActiveTimer = null
      }
    }
    if (active) {
      this.userActive = true
      this.lastInputAt = Date.now()
      const parsedTtl = Number(ttl)
      const timeout = Number.isFinite(parsedTtl) ? parsedTtl : this.userActiveTimeout
      clearTimer()
      if (timeout > 0) {
        this.userActiveTimer = setTimeout(() => {
          this.userActive = false
          this.userActiveTimer = null
        }, timeout)
      }
    this.cancelIdleNudge()
    } else {
      clearTimer()
      this.userActive = false
    }
  }
  maybeNudgeForSequences(chunk = '') {
    if (!this.enableNudge) {
      return
    }
    if (!chunk || typeof chunk !== 'string') {
      return
    }
    const detection = this.ansiTracker.push(chunk)
    if (!detection) {
      return
    }
    if (this.ignoreNudgeOutput || this.userActive) {
      return
    }
    if (this.nudging || !this.canNudge) {
//      console.log('[nudge] guard: nudging/canNudge', { nudging: this.nudging, canNudge: this.canNudge, reason: detection.reason })
      return
    }
    const sinceInput = Date.now() - this.lastInputAt
    if (sinceInput < 200) {
//      console.log('[nudge] guard: recent input', { sinceInput, reason: detection.reason })
      return
    }
//    console.log('[nudge] scheduling idle nudge', {
//      reason: detection.reason,
//      sinceInput,
//      preview: chunk.slice(0, 160)
//    })
    this.requestIdleNudge()
  }
  cancelIdleNudge() {
    if (this.idleNudgeTimer) {
      clearTimeout(this.idleNudgeTimer)
      this.idleNudgeTimer = null
    }
    this.awaitingIdleNudge = false
  }
  requestIdleNudge() {
    if (this.awaitingIdleNudge || this.nudging || !this.canNudge) {
      return
    }
    this.awaitingIdleNudge = true
    this.scheduleIdleNudge()
  }
  scheduleIdleNudge() {
    if (!this.awaitingIdleNudge) {
      return
    }
    const delay = this.idleNudgeDelay || 500
    if (this.idleNudgeTimer) {
      clearTimeout(this.idleNudgeTimer)
    }
    this.idleNudgeTimer = setTimeout(() => {
      if (this.nudging || !this.canNudge) {
        this.cancelIdleNudge()
        return
      }
      this.idleNudgeTimer = null
      this.awaitingIdleNudge = false
      this.canNudge = false
//      console.log('[nudge] idle window elapsed')
      this.forceTerminalNudge()
    }, delay)
  }
  forceTerminalNudge() {
    if (!this.ptyProcess || this.nudging) {
//      console.log('[nudge] force skipped', { hasPty: !!this.ptyProcess, nudging: this.nudging })
      return
    }
    this.cancelIdleNudge()
    const baseCols = Number.isFinite(this.cols) ? this.cols : (this.vt && Number.isFinite(this.vt.cols) ? this.vt.cols : 80)
    const baseRows = Number.isFinite(this.rows) ? this.rows : (this.vt && Number.isFinite(this.vt.rows) ? this.vt.rows : 24)
    const cols = Math.max(2, Math.floor(baseCols))
    const rows = Math.max(2, Math.floor(baseRows))
    if (cols <= 2) {
      return
    }
    this.ignoreNudgeOutput = true
    this.nudging = true
//    console.log('[nudge] shrink start', { cols: cols - 1, rows })
    this.resize({ cols: cols - 1, rows })
    if (this.nudgeRestoreTimer) {
      clearTimeout(this.nudgeRestoreTimer)
    }
    this.nudgeRestoreTimer = setTimeout(() => {
//      console.log('[nudge] restore', { cols, rows })
//      console.log('[nudge] restore start', { cols, rows })
      this.resize({ cols, rows })
      if (this.nudgeReleaseTimer) {
        clearTimeout(this.nudgeReleaseTimer)
      }
      this.nudgeReleaseTimer = setTimeout(() => {
        this.nudging = false
        this.canNudge = true
        this.ignoreNudgeOutput = false
//        console.log('[nudge] complete')
        this.nudgeReleaseTimer = null
      }, 100)
      this.nudgeRestoreTimer = null
    }, 100)
  }
  _log(buf, cleaned) {


    /*

    /logs
      /shell
        /[...group]
          ### info

          ### stdout

    */
    let info = {
      path: this.path,
      cmd: this.cmd,
      index: this.index,
      group: this.group,
      env: this.env,
      done: this.done,
      ready: this.ready,
      id: this.id,
      ts: Date.now()
    }

    let time = `${new Date().toLocaleString()} (${Date.now()})`

    let infoYAML = YAML.stringify(info)
    let data = {}
    data.info = `######################################################################
#
# group: ${this.group}
# id: ${this.id}
# index: ${this.index}
# cmd: ${this.cmd}
# timestamp: ${time}

${infoYAML}

`

    data.buf = `######################################################################
#
# group: ${this.group}
# id: ${this.id}
# index: ${this.index}
# cmd: ${this.cmd}
# timestamp: ${time}
#

${buf}

`

    data.cleaned = `######################################################################
#
# group: ${this.group}
# id: ${this.id}
# index: ${this.index}
# cmd: ${this.cmd}
# timestamp: ${time}

${cleaned}

`

    this.kernel.log(data, this.group, info) 


  }
  stream(msg, callback) {
    if (msg === "\u0007") {
      // Ignore bell sound escape character because it slows down everything and makes redundant sound
      callback()
      return
    }
    this.vt.write(msg, () => {
      let buf
      try {
        buf = this.vts.serialize()
      } catch (e) {
        console.log("vts serialize error", e)
        callback()
        return
      }
      let cleaned = this.stripAnsi(buf)
      let response = {
        id: this.id,
        raw: msg,
        cleaned,
        state: cleaned,
        buf,
        shell_id: this.id
      }
      this.state = cleaned
      if (this.cb) {
        this.cb(response)
      }

      // Decide whether to kill or continue
      if (this.ready) {
        // when ready, watch out for the prompt pattern that terminates with [\r\n ]
        let termination_prompt_re = new RegExp(this.prompt_pattern + "[ \r\n]*$", "g")
        let line = cleaned.replaceAll(/[\r\n]/g, "")
        let test = line.match(termination_prompt_re)
        if (test) {
          let cache = cleaned
          let cached_msg = msg
          // todo: may need to handle cases when the command returns immediately with no output (example: 'which brew' returns immediately with no text if brew doesn't exist)
          setTimeout(() => {
            if (cache === cleaned) {
              if (this.params.onprompt) {
                this.params.onprompt(this)
              }
              if (this.input || this.persistent) {
//                if (this.cb) this.cb({
//                  //raw: cached_msg,
//                  //raw: msg,
//                  //raw: "",
//                  cleaned,
//                  state: cleaned,
//                  prompt: true
//                })
                callback()
              } else {
                callback()
                this.kill()
              }
            } else {
              //console.log("## more incoming... ignore")
            }
          }, 500)
        } else {
          callback()
        }
      } else {
        callback()
        // when not ready, wait for the first occurence of the prompt pattern.
        let prompt_re = new RegExp(this.prompt_pattern, "g")
        let test = cleaned.replaceAll(/[\r\n]/g, "").match(prompt_re)
        if (test) {
          if (test.length > 0) {
            this.ready = true
            if (this.params && this.params.onready) {
              this.params.onready()
            }
            if (this.ptyProcess) {
              this.ptyProcess.write(`${this.cmd}${this.EOL}`)
//              setTimeout(() => {
//                this.ptyProcess.write('\x1B[?2004h');
//              }, 500)
            }
          }
        }
        //callback()
      }
    })
  }
  regex (str) {
    let matches = /^\/([^\/]+)\/([dgimsuy]*)$/.exec(str)
    if (!/g/.test(matches[2])) {
      matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
    }
    return new RegExp(matches[1], matches[2])
  }
}
module.exports = Shell
