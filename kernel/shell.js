const { Terminal } = require('xterm-headless');
const { SerializeAddon } = require("xterm-addon-serialize");
const fastq = require('fastq')
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty-prebuilt-multiarch-cp');
const path = require("path")
const unparse = require('yargs-unparser-custom-flag');
const shellPath = require('shell-path');
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
    this.shell = this.platform === 'win32' ? 'cmd.exe' : 'bash';
    //this.vt = new Terminal({ allowProposedApi: true, scrollback: 5, })
    this.vt = new Terminal({ allowProposedApi: true })
    this.vts = new SerializeAddon()
    this.vt.loadAddon(this.vts)
    this.checkpoint = {
      on: [],
      sequence: [],
      serialized: 0
    }
    this.queue = fastq((data, cb) => {
      this.stream(data)
      cb()
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

    // 1. id
    this.id = (params.id ? params.id : uuidv4())

    // 2. group id
    this.group = params.group

    // 2. env
    // default env
    this.env = Object.assign({}, process.env)
    if (this.platform === 'win32') {
      // ignore 
    } else {
      this.env.PATH = shellPath.sync() || [
        './node_modules/.bin',
        '/.nodebrew/current/bin',
        '/usr/local/bin',
        this.env.PATH
      ].join(':');
    }
    // custom env was passed in
    if (params.env) {
      for(let key in params.env) {
        // iterate through the env attributes
        if (key === "path") {
          // "path" is a special case => merge with process.env.PATH
          let k = (this.platform === "win32" ? "Path" : "PATH")
          this.env[k] = `${params.env.path.join(path.delimiter)}${path.delimiter}${this.env[k]}`
        } else {
          // for the rest of attributes, simply set the values
          this.env[key] = params.env[key]
        }
      }
    }

    // 3. path => path can be http, relative, absolute
    this.path = params.path

    // automatically add self to the shells registry
    this.kernel.shell.add(this)

    console.log("requesting", params)
    let response = await this.request(params, async (stream) => {
      if (stream.prompt) {
        console.log("resolve", stream.prompt)
        this.resolve()
      } else {
        if (ondata) ondata(stream)
      }
    })
    console.log("returning", this.id)

    return response

//    return this.id
  }
  send(message, newline, cb) {
    if (this.ptyProcess) {
      this.cb = cb
      return new Promise((resolve, reject) => {
        this.resolve = resolve
        this.cmd = this.build({ message })
        this.ptyProcess.write(this.cmd)
        if (newline) {
          this.ptyProcess.write(os.EOL)
        }
      })
    }
  }
  enter(message, cb) {
    if (this.ptyProcess) {
      this.cb = cb
      return new Promise((resolve, reject) => {
        this.resolve = resolve
        this.cmd = this.build({ message })
        this.ptyProcess.write(this.cmd)
        this.ptyProcess.write(os.EOL)
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
        //cols: 1000,
        rows: 30,
      }
      if (cwd) {
        config.cwd = path.resolve(cwd)
      }
      config.env = this.env
      //let re = /(.+\r\n)(\1)/gs
      let re = /([\r\n]+[^\r\n]+)(\1)/gs
      let term = pty.spawn(this.shell, [], config)
      let ready
      let vt = new Terminal({
        allowProposedApi: true
      })
      let vts = new SerializeAddon()
      vt.loadAddon(vts)

      term.onData((data) => {
        if (ready) {
          vt.write(data, () => {
            let buf = vts.serialize()
            let test = re.exec(buf)
            if (test && test.length >= 2) {
              const escaped = this.stripAnsi(test[1])
                .replaceAll(/[\r\n]/g, "")
                .trim()
                .replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
              term.kill()
              vt.dispose()
              resolve(escaped)
            }
          })
        } else {
          setTimeout(() => {
            if (!ready) {
              ready = true
              term.write(os.EOL)
              term.write(os.EOL)
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
  build (params) {
    if (params.message) {
      if (typeof params.message === "string") {
        // raw string -> do not touch
        return params.message
      } else if (Array.isArray(params.message)) {
        // command line message
        let chunks = params.message.map((item) => {
          let tokens = item.split(" ")
          if (tokens.length > 1) {
            return `"${item}"`
          } else {
            return item
          }
        })
        return `${chunks.join(" ")}`
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
  exec(params) {
    this.cmd = this.build(params)
    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      try {
        const config = {
          name: 'xterm-color',
          //cols: 1000,
          rows: 30,
        }
        if (params.path) {
          config.cwd = path.resolve(params.path)
        }

        config.env = this.env

        console.log("config", config)

        if (!this.ptyProcess) {
          // ptyProcess doesn't exist => create
          this.done = false
          this.ptyProcess = pty.spawn(this.shell, [], config)
          this.ptyProcess.onData((data) => {
            if (!this.done) {
              this.queue.push(data)
            }
          });
        }
      } catch (e) {
        this.kill()
      }
    })
  }
  stop(message) {
    return this.kill(message)
  }
  kill(message) {
    this.done = true
    this.ready = false
    if (this.resolve) {
      if (message) {
        this.resolve(message)
      } else {
        let buf = this.stripAnsi(this.vts.serialize())
        this.resolve(buf)
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
  stream(msg) {
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
        let test = cleaned.replaceAll(/[\r\n]/g, "").match(termination_prompt_re)
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
              } else {
                this.kill()
              }
            } else {
              //console.log("## more incoming... ignore")
            }
          }, 500)
        }
      } else {
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
