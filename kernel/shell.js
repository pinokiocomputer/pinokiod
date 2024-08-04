const { Terminal } = require('xterm-headless');
const { SerializeAddon } = require("xterm-addon-serialize");
const sanitize = require("sanitize-filename");
const YAML = require('yaml')

const fastq = require('fastq')
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty-prebuilt-multiarch-cp');
const path = require("path")
const sudo = require("sudo-prompt-programfiles-x86");
const unparse = require('yargs-unparser-custom-flag');
const shellPath = require('shell-path');
const Util = require('./util')
const Environment = require('./environment')
const home = os.homedir()
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
    this.kernel = kernel
    this.platform = os.platform()
    this.logs = {}
    this.shell = this.platform === 'win32' ? 'cmd.exe' : 'bash';

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
//      cb()
    }, 1)

  }
  async start(params, ondata) {

    /*
      params := {
        group: <group id>,
        id: <shell id>,
        path: <shell cwd (always absolute path)>,
        env: <environment value key pairs>
      }
    */
    this.cols = params.cols ? params.cols : 100;
    this.rows = params.rows ? params.rows : 30;

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
    
    if (this.env.CUDA_HOME) {
      delete this.env.CUDA_HOME
    }
    if (this.env.CUDA_PATH) {
      delete this.env.CUDA_PATH
    }

    this.env.CMAKE_OBJECT_PATH_MAX = 1024

    // First override this.env with system env
    let system_env = await Environment.get(this.kernel.homedir)
    this.env = Object.assign(this.env, system_env)

    // if the shell is running from a script file, the params.$parent will include the path to the parent script
    // this means we need to apply app environment as well
    if (params.$parent) {
      let api_path = Util.api_path(params.$parent.path, this.kernel)

      // initialize folders
      await Environment.init_folders(api_path)

      // apply app env to this.env
      let app_env = await Environment.get(api_path)
      this.env = Object.assign(this.env, app_env)
    }
    let PATH_KEY;
    if (this.env.Path) {
      PATH_KEY = "Path"
    } else if (this.env.PATH) {
      PATH_KEY = "PATH"
    }
    if (this.platform === 'win32') {
      // ignore 
    } else {
      this.env[PATH_KEY]= shellPath.sync() || [
        './node_modules/.bin',
        '/.nodebrew/current/bin',
        '/usr/local/bin',
        this.env[PATH_KEY]
      ].join(':');
    }

    this.env[PATH_KEY] = this.env[PATH_KEY] + path.delimiter + path.resolve(this.kernel.homedir, 'bin')


    if (params.env) {
      for(let key in params.env) {
        // iterate through the env attributes
        let val = params.env[key]
        if (key.toLowerCase() === "path") {
          // "path" is a special case => merge with process.env.PATH
          if (params.env.path) {
            this.env[PATH_KEY] = `${params.env.path.join(path.delimiter)}${path.delimiter}${this.env[PATH_KEY]}`
            //this.env.PINOKIO_PATH = params.env.path.join(path.delimiter)
            //this.env[PATH_KEY] = `$PINOKIO_PATH${path.delimiter}${this.env[PATH_KEY]}`
          }
          if (params.env.PATH) {
            this.env[PATH_KEY] = `${params.env.PATH.join(path.delimiter)}${path.delimiter}${this.env[PATH_KEY]}`
            //this.env.PINOKIO_PATH = params.env.PATH.join(path.delimiter)
            //this.env[PATH_KEY] = `$PINOKIO_PATH${path.delimiter}${this.env[PATH_KEY]}`
          }
          if (params.env.Path) {
            this.env[PATH_KEY] = `${params.env.Path.join(path.delimiter)}${path.delimiter}${this.env[PATH_KEY]}`
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
      if (/[\r\n]/.test(this.env[key])) {
        delete this.env[key]
      }
    }


    if (params["-env"] && Array.isArray(params["-env"])) {
      for(let key of params["-env"]) {
        delete this.env[key]
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
            reject(err)
          } else if (stderr) {
            reject(stderr)
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
        if (stream.prompt) {
          this.resolve()
        } else {
          if (ondata) ondata(stream)
        }
      })
      return response
    }

//    return this.id
  }
  emit(message) {
    if (this.ptyProcess) {
      this.ptyProcess.write(message)
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
            if (newline) {
              this.ptyProcess.write(os.EOL)
            }
          }
        } else {
          this.cmd = this.build({ message })
          this.ptyProcess.write(this.cmd)
          if (newline) {
            this.ptyProcess.write(os.EOL)
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
            this.ptyProcess.write(os.EOL)
          }
        } else {
          this.cmd = this.build({ message })
          this.ptyProcess.write(this.cmd)
          this.ptyProcess.write(os.EOL)
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
      })
    }
  }
  clear() {
    let buf = this.vts.serialize()
    let cleaned = this.stripAnsi(buf)

    // Log before resolving
    this._log(buf, cleaned)
    if (this.platform === 'win32') {
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
        cols: this.cols,
        rows: this.rows,
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
      let ready
      let vt = new Terminal({
        allowProposedApi: true
      })
      let vts = new SerializeAddon()
      vt.loadAddon(vts)

      let queue = fastq((data, cb) => {
        vt.write(data, () => {
          let buf = vts.serialize()
          let re = /(.+)echo pinokio[\r\n]+pinokio[\r\n]+(\1)/gs
          const match = re.exec(buf)
          if (match && match.length > 0) {
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
      }, 1)
      term.onExit((result) => {
        console.log("onExit", { result })
      })
      term.onData((data) => {
        if (ready) {
          queue.push(data)
        } else {
          setTimeout(() => {
            if (!ready) {
              ready = true
              term.write(`echo pinokio${os.EOL}echo pinokio${os.EOL}`)
            }
          }, 500)
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
  exists(abspath) {
    return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
  }
  build (params) {

    if (params.message) {
      if (typeof params.message === "string") {
        // raw string -> do not touch
        return params.message
      } else if (Array.isArray(params.message)) {
        // if params.message is empty, filter out
        let delimiter = " && "
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
  async activate(params) {

    // conda and venv can coexist
    // 1. first process conda
    //    - if conda is not specified => base => no need to create
    //    - if conda is specified
    //      - if string => the string is the path => create if doesn't exist yet
    //      - if object => the conda.path is the path => create if doesn't exist yet
    // 2. then process venv


    // 1. conda
    let conda_path
    let conda_name
    let conda_python = "python=3.10"
    let conda_args

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

            // conda_python
            if (params.conda.python) {
              conda_python = params.conda.python
            }
          }
        }
      }
    } else {
      conda_name = "base"
    }


    // 2. conda_activation

    let conda_activation = []
    if (conda_path) {
      let env_path = path.resolve(params.path, conda_path)
      let env_exists = await this.exists(env_path)
      if (env_exists) {
        conda_activation = [
          (this.platform === 'win32' ? 'conda_hook' : `eval "$(conda shell.bash hook)"`),
          `conda deactivate`,
          `conda deactivate`,
          `conda deactivate`,
          `conda activate ${env_path}`,
        ]
      } else {
        conda_activation = [
          (this.platform === 'win32' ? 'conda_hook' : `eval "$(conda shell.bash hook)"`),
          `conda create -y -p ${env_path} ${conda_python} ${conda_args ? conda_args : ''}`,
          `conda deactivate`,
          `conda deactivate`,
          `conda deactivate`,
          `conda activate ${env_path}`,
        ]
      }
    } else if (conda_name) {
      if (conda_name === "base") {
        conda_activation = [
          (this.platform === 'win32' ? 'conda_hook' : `eval "$(conda shell.bash hook)"`),
          `conda deactivate`,
          `conda deactivate`,
          `conda deactivate`,
          `conda activate ${conda_name}`,
        ]
      } else {
        let envs_path = this.kernel.bin.path("miniconda/envs")
        let env_path = path.resolve(envs_path, conda_name)
        let env_exists = await this.exists(env_path)
        if (env_exists) {
          conda_activation = [
            (this.platform === 'win32' ? 'conda_hook' : `eval "$(conda shell.bash hook)"`),
            `conda deactivate`,
            `conda deactivate`,
            `conda deactivate`,
            `conda activate ${conda_name}`,
          ]
        } else {
          conda_activation = [
            (this.platform === 'win32' ? 'conda_hook' : `eval "$(conda shell.bash hook)"`),
            `conda create -y -n ${conda_name} ${conda_python} ${conda_args ? conda_args : ''}`,
            `conda deactivate`,
            `conda deactivate`,
            `conda deactivate`,
            `conda activate ${conda_name}`,
          ]
        }
      }
    } else {
      // no conda name or conda path => means don't activate any env
      conda_activation = []
    }

    // Visual Studio Build Tools (Exception)
    const vs_path_env = this.kernel.bin.vs_path_env
    console.log({ vs_path_env })
    if (vs_path_env && vs_path_env.PATH) {
      const vs = `conda env config vars set ${vs_path_env.PATH.join(path.sep)}${path.sep}%PATH%`
      console.log({ vs })
      conda_activation.push(vs)
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


    // 2. venv
    let venv_activation
    if (params.venv) {
      let env_path = path.resolve(params.path, params.venv)
      let activate_path = (this.platform === 'win32' ? path.resolve(env_path, "Scripts", "activate") : path.resolve(env_path, "bin", "activate"))
      let env_exists = await this.exists(env_path)
      if (env_exists) {
        venv_activation = [
          (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
        ]
      } else {
        venv_activation = [
          `python -m venv ${env_path}`,
          (this.platform === "win32" ? `${activate_path} ${env_path}` : `source ${activate_path} ${env_path}`),
        ]
      }
    } else {
      venv_activation = []
    }

    // 3. construct params.message
    params.message = conda_activation.concat(venv_activation).concat(params.message)
    return params
  }
  async exec(params) {
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
            if (!this.done) {
              this.queue.push(data)
            }
          });
          this.ptyProcess.onExit((result) => {
            console.log("onExit", result)
          })
        }
      } catch (e) {
        console.log("** Error", e)
        this.kill()
      }
    })
    console.log("Exec finished", res)
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
    }
  }
  kill(message, force) {

    this.done = true
    this.ready = false

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
    if (this.ptyProcess) {
      this.ptyProcess.kill()
      this.ptyProcess = undefined
    }

    // automatically remove the shell from this.kernel.shells
    this.kernel.shell.rm(this.id)

  }
  log() {
    let buf = this.vts.serialize()
    let cleaned = this.stripAnsi(buf)
    this._log(buf, cleaned)
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
    this.vt.write(msg, () => {
      let buf = this.vts.serialize()
      let cleaned = this.stripAnsi(buf)
      let response = {
        id: this.id,
        raw: msg,
        cleaned,
        state: cleaned
      }
      if (this.cb) this.cb(response)

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
              if (this.persistent) {
                if (this.cb) this.cb({
                  //raw: cached_msg,
                  //raw: msg,
                  //raw: "",
                  cleaned,
                  state: cleaned,
                  prompt: true
                })
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
            if (this.ptyProcess) {
              this.ptyProcess.write(`${this.cmd}${os.EOL}`)
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
