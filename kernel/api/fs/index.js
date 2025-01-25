const path = require('path')
//const decompress = require('decompress');
const fs = require("fs")
const fse = require('fs-extra')
const { rimraf } = require('rimraf')
const Pdrive = require('pdrive')
const { DownloaderHelper } = require('node-downloader-helper');
const randomUseragent = require('random-useragent');
const symlinkDir = require('symlink-dir')
const retry = require('async-retry');
const { createHash } = require('crypto');
const Environment = require("../../environment")
const Util = require("../../util")

const log = (msgs, ondata) => {
  for(let msg of msgs) {
    if (typeof msg === "object") {
      msg = JSON.stringify(msg, null, 2).replace(/\n/g, "\r\n")
    }
    if (ondata) {
      ondata({ raw: "\r\n" + msg })
    }
    console.log(msg)
  }
}

class FS {
  async read(req, ondata, kernel) {
    /*
      params := {
        path: <filepath>,
        encoding: "ascii"|"base64"|"base64url"|"hex"|"utf8"|"utf-8"|"binary"
      }
    */
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let filepath = kernel.api.filePath(req.params.path, cwd)
    //let filepath = path.resolve(cwd, req.params.path)
    let data = await fs.promises.readFile(filepath, req.params.encoding)
    return data
  }
  async cat(req, ondata, kernel) {
    /*
      params := {
        path: <filepath>,
      }
    */
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let filepath = kernel.api.filePath(req.params.path, cwd)
    //let filepath = path.resolve(cwd, req.params.path)
    let data = await fs.promises.readFile(filepath, "utf8")
    ondata({
      raw: data.replace(/\n/g, "\r\n")
    })
    ondata({
      raw: "\r\n"
    })
  }
//  async unzip(req, ondata, kernel) {
//    /*
//    params := {
//      args: [input, [output], [options]]
//    }
//    */
//    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
//    if (req.params.length > 0) {
//      req.params[0] = path.resolve(cwd, req.params[0])
//    }
//    if (req.params.length > 1) {
//      req.params[1] = path.resolve(cwd, req.params[1])
//    }
//    await decompress(...req.params)
//  }

  async open(req, ondata, kernel) {
    /*
      params := {
        path: <filepath>,
        mode: "view(default)|open"
      }
      open finder/file explorer at path
    */
    let dirPath = path.resolve(req.cwd, req.params.path)
    ondata({ raw: `\r\nopening path: ${dirPath}\r\n` })
    if (req.params.mode) {
      Util.openfs(dirPath, req.params.mode)
    } else {
      Util.openfs(dirPath)
    }
  }

  async link(req, ondata, kernel) {
    let response = await this.share(req, ondata, kernel)
    return response
  }

  async share(req, ondata, kernel) {
    /////////////////////////////////////////////////////////////////////////////
    //
    //    1. peer to peer shared drive
    //
    //      1.1. With no peers
    //      {
    //        “method”: “fs.share”,
    //        “params”: {
    //          "drive": {
    //            “models/checkpoints": "app/models/checkpoints",
    //            “models/vae": "app/models/VAE",
    //          }
    //        }
    //      }
    //
    //      1.2. 1:1 Drive mapping (1 file path per 1 drive folder)
    //      {
    //        “method”: “fs.share”,
    //        “params”: {
    //          "drive": {
    //            “models/checkpoints": "app/models/checkpoints",
    //            “models/vae": "app/models/VAE",
    //          },
    //          “peers”: [ “https://github.com/cocktailpeanut/comfyui.git" ]
    //        }
    //      }
    //
    //
    //      1.3. 1:N Drive mapping (N file paths per 1 drive folder)
    //      {
    //        “method”: “fs.share”,
    //        “params”: {
    //          "drive": {
    //            “models/checkpoints": "app/models/checkpoints",
    //            “models/loras": [ "app/models/Lora", "app/models/LyCORIS" ],
    //          },
    //          “peers”: [ “https://github.com/cocktailpeanut/comfyui.git" ]
    //        }
    //      }
    //
    //    2. centralized shared drive (for package registries)
    //
    //    {
    //      “method”: “fs.share”,
    //      “params”: {
    //        "drive": {
    //          “models/checkpoints": "app/models/checkpoints",
    //          “models/loras": [ "app/models/Lora", "app/models/LyCORIS" ],
    //        },
    //        “parent”: "pip"|"npm"|"github"
    //      }
    //    }
    //
    //    2. pip
    //
    //      1.1. Share all pip
    //      {
    //        “method”: “fs.share”,
    //        “params”: {
    //          "venv": "app/env"
    //        }
    //      }
    //
    /////////////////////////////////////////////////////////////////////////////

    ondata({ raw: "\r\ncreating a shared drive:\r\n" + JSON.stringify(req.params, null, 2).replace(/\n/g, "\r\n") })


    // start with the proces.env => merge pinokio global ENVIRONMENT => merge app ENVIRONMENT
    let current_env = await Environment.get2(req.parent.path, kernel)

    // if PINOKIO_DRIVE environment variable is specified, use this custom value for the drive path instead of ~/pinokio/drive
    let env_drive_path = current_env.PINOKIO_DRIVE
    let drive_home
    if (env_drive_path) {
      let api_path = `${kernel.homedir}${path.sep}api`
      let rel_path = path.relative(api_path, req.parent.path)
      let api_name = rel_path.split(path.sep)[0]
      let current_api_path = `${api_path}${path.sep}${api_name}`
      drive_home = path.resolve(current_api_path, env_drive_path)
    }

    if (req.params.venv) {
      // check if the python version is 3.10.16
      // only if 3.10.16, allow fs.link for now

      let pyvenv_config_path = path.resolve(req.cwd, req.params.venv, "pyvenv.cfg")
      let pyvenv_str = await fs.promises.readFile(pyvenv_config_path, "utf-8")
      console.log({ pyvenv_str })
      if (/version.*=[ ]*3\.10\..+/gi.test(pyvenv_str)) {
        ondata({ raw: "\r\npython verrsion 3.10.x. Proceed with fs.link.\r\n" })
      } else {
        ondata({ raw: "\r\npython verrsion is NOT 3.10.x. Not implemented yet. Pass.\r\n" })
        return
      }


      // pip sharing
      // 1. get all pip items
      let p
      let drive_path
      if (kernel.platform === "win32") {
        p = path.resolve(req.cwd, req.params.venv, "Lib", "site-packages")
        drive_path = "pip/Lib/site-packages"
      } else {
        p = path.resolve(req.cwd, req.params.venv, "lib", "python3.10", "site-packages")
        drive_path = "pip/lib/python3.10/site-packages"
      }
      const res = await kernel.python.call(
        "mod",
        kernel.bin.path("py"),
        "get",
        [p],
        ondata
      )
      log([res], ondata)
      // symlink:
      //  from => :package_path
      //  to => /drives/packages/pip/:package_name/:package_version
      const drivePath = drive_home || kernel.path("drive")
      const drive = new Pdrive(drivePath)
      for(let name in res) {
        /*
          torch: {
            version: "2.1",
            copy: [
              '../../../bin/torchrun',
              '../../../bin/convert-onnx-to-caffe2',
              '../../../bin/convert-caffe2-to-onnx'
            ],
            move: [
              "torchgen",
              "functorch",
              "torch"
            ]
          },


          => 

          {
            copy: {
              '../../../bin/torchrun': path.resolve(p, '../../../bin/torchrun')
              '../../../bin/convert-onnx-to-caffe2': path.resolve(p, '../../../bin/convert-onnx-to-caffe2'),
              '../../../bin/convert-caffe2-to-onnx': path.resolve(p, '../../../bin/convert-caffe2-to-onnx')
            },
            move: {
              "torchgen": "torchgen",
              "functorch": "functorch",
              "torch": "torch"
            },
            parent: "pip/torch/2.1/lib/python3.10/site-packages"
          }
        */
        const copy = res[name].copy
        const move = res[name].move
        const version = res[name].version
        const url = res[name].url

        if (version) {

          let namespace
          // handle custom install from url
          log(["> Namespace resolution"], ondata)
          if (url) {
            log(["> Custom url exists. Resolve custom namespace..."], ondata)
            if (res[name].archive_info) {
              let info = res[name].archive_info
              log(["> Archive: ", { url, info }], ondata)
              // try to get sha256 first
              if (info.hashes) {
                if (info.hashes.sha256) {
                  let hash = info.hashes.sha256
                  namespace = `${name}/${version}-f-${hash.slice(0, 4)}`
                } else {
                  let keys = Object.keys(info.hashes)
                  // just use the first hash
                  let key = keys[0]
                  let hash = info.hashes[key]
                  namespace = `${name}/${version}-${hash.slice(0, 4)}`
                }
              }
              // otherwise get any other hash
            } else if (res[name].vcs_info) {
              let info = res[name].vcs_info
              log(["> VCS: ", { url, info }], ondata)
              let id = info.commit_id || info.requested_revision
              namespace = `${name}/${version}-${info.vcs}-${id.slice(0, 4)}`
            } else if (res[name].dir_info) {
              let info = res[name].dir_info
              log(["> Directory: ", { url, info }], ondata)
              let hash = createHash('sha256').update(url).digest('hex')
              namespace = `${name}/${version}-d-${hash.slice(0, 4)}`
            }

            // IMPORTANT: if the namespace doesn't get resolved, do NOT create a drive 
            if (!namespace) {
              continue
            }

          } else {
            namespace = `${name}/${version}`
          }

          log(["> Resolved namespace", namespace], ondata)

          let site_packages_root;
          if (kernel.platform === "win32") {
            site_packages_root = `pip/${namespace}/Lib/site-packages`
          } else {
            site_packages_root = `pip/${namespace}/lib/python3.10/site-packages`
          }
          const d = {
            copy: {},
            move: {},
            parent: site_packages_root,
          }


          // fs.link should overwrite by default.
          if (req.params.options) {
            d.options = req.params.options 
          } else {
            d.options = {
              overwrite: true
            }
          }

          // if the version is NOT final, overwrite.
          let re = /^\d+(\.\d+)*$/        // regex for testing final versions like 1.2, 1.1.1, 1.2.1.1, etc.
          if (re.test(version)) {
            // final version
          } else {
            d.options.overwrite = true
          }

          for(let relpath of copy) {
            if (drive_home) {
              d.copy[relpath] = path.resolve(drive_home, p, relpath)
            } else {
              d.copy[relpath] = kernel.path("drive", p, relpath)
            }
          }
          for(let relpath of move) {
            if (drive_home) {
              d.move[relpath] = path.resolve(drive_home, p, relpath)
            } else {
              d.move[relpath] = kernel.path("drive", p, relpath)
            }
          }
          ondata({
            raw: "\r\nLINKING DRIVES:\r\n" + JSON.stringify(d, null, 2).replace(/\n/g, "\r\n")
          })
          await drive.create(d)
          ondata({
            raw: "Done.\r\n"
          })
        } else {
          ondata({
            raw: "\r\nNo version specified: " + name + " => Ignore"
          })
        }

      }
    } else if (req.params.drive) {
      const drivePath = drive_home || kernel.path("drive")
      const drive = new Pdrive(drivePath)
      for(const route in req.params.drive) {
        const link = req.params.drive[route]
        // Link path validation
        if (Array.isArray(link)) {
          let toContinue = false;
          for(let ln of link) {
            if (path.isAbsolute(ln) || ln.startsWith(".")) {
              toContinue = true
              break
            }
          }
          if (toContinue) continue
        } else {
          if (path.isAbsolute(link) || link.startsWith(".")) {
            continue
          }
        }
        // Drive path validation
        if (path.isAbsolute(route) || route.startsWith(".")) {
          toContinue = true
          break
        }

        let linkPath
        if (Array.isArray(link)) {
          linkPath = link.map((ln) => {
            return path.resolve(req.cwd, ln)
          })
        } else {
          linkPath = path.resolve(req.cwd, link)
        }

        req.params.drive[route] = linkPath
      }
      await drive.create({
        uri: req.parent.git,
        drive: req.params.drive,
        peers: (req.params.peers ? req.params.peers : [])
      })
      ondata({ raw: `\r\nDone!` })
    } else {
      ondata({ raw: `\r\nMust pass an 'drive' mapping` })
    }

  }
  async rm(req, ondata, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    //let filepath = path.resolve(cwd, req.params.path)
    let filepath = kernel.api.filePath(req.params.path, cwd)
//    await fs.promises.rm(filepath)
    ondata({ raw: "\r\nremoving:\r\n" + filepath + "\r\n" })
    await rimraf(filepath)
    ondata({ raw: "done\r\n" })
  }
  async copy(req, ondata, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    //let src = path.resolve(cwd, req.params.src)
    //let dest = path.resolve(cwd, req.params.dest)

    let src = kernel.api.filePath(req.params.src, cwd)
    let dest = kernel.api.filePath(req.params.dest, cwd)
    let options = req.params.options
    ondata({ raw: "\r\ncopying:\r\nfrom: " + src + "\r\nto: " + dest + "\r\n" })
    await fs.promises.cp(src, dest, options)
    ondata({ raw: "done\r\n" })
  }

  async init(req, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    //let filepath = path.resolve(cwd, req.params.path)
    let filepath = kernel.api.filePath(req.params.path, cwd)
    let folder = path.dirname(filepath)
    await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
    return filepath
  }
  async _delimit (req, filepath) {
    if (req.params.join) { 
      if (Buffer.isBuffer(req.params.join)) {
        await fs.promises.appendFile(filepath, req.params.join)
      } else if (typeof req.params.join === 'string') {
        await fs.promises.appendFile(filepath, req.params.join, "utf8")
      } else {
        await fs.promises.appendFile(filepath, String(req.params.join), "utf8")
      }
    }
  }
  async _append (filepath, chunk, type) {
    // 3.1. Write the chunk
    if (type === 'text') {
      await fs.promises.appendFile(filepath, chunk, "utf8")
    } else if (type === 'json') {
      await fs.promises.appendFile(filepath, JSON.stringify(chunk), "utf8")
    } else if (type === 'json2') {
      await fs.promises.appendFile(filepath, JSON.stringify(chunk, null, 2), "utf8")
    } else if (type === 'buffer') {
      await fs.promises.appendFile(filepath, chunk)
    }
  }

  async append(req, ondata, kernel) {

    /*
      params := {
        path: <filepath>,
        <json|buffer|text>: ___,
        join: {                                         // used when the data is an array 
          <buffer|text>: <example: \n, {{os.EOL}} (default is nothing)>
        }
      }
    */


    let filepath = await this.init(req, kernel)

    // 1. get the data type from req.params

    let type
    if (req.params.json) {
      type = "json"
    } else if (req.params.json2) {
      type = "json2"
    } else if (req.params.buffer) {
      type = "buffer"
    } else if (req.params.text) {
      type = "text"
    }

    // 2. get the data
    let data = req.params[type]
    await this._append(filepath, data, type)


//    // 3. if array, iterate through the data and append
//    if (Array.isArray(data)) {
//      let chunks = data
//      for(let i=0; i<chunks.length; i++) {
//        let chunk = chunks[i]
//
//        await this._append(filepath, chunk, type)
//        await this._delimit(req, filepath)
//
//      }
//    } else {
//      // 4. if not array, just append once
//      await this._append(filepath, data, type)
//    }

  }
  async write (req, ondata, kernel) {
    /*
      params := {
        path: <filepath>,
        <json|buffer|text>: ___,
        join: {                                                        // used when the data is an array 
          <buffer|text>: <example: \n, {{os.EOL}} (default is nothing)>
        }
      }
    */

    let filepath = await this.init(req, kernel)

    // remove the file first (to start from scratch)
    await fs.promises.rm(filepath, { recursive: true }).catch((e) => { })

    // append to the empty file
    await this.append(req, ondata, kernel)
  }
  async _download(req, ondata, kernel) {
    /*
      params := {
        url,
        dir: <the directory to store the file to (the file name will be guessed from content-disposition)>,
        path: <the eact file path to store the file under>
      }
    */
    let params = req.params
    let url = params.url || params.uri
    let dl
    let folder
    let userAgent = randomUseragent.getRandom((ua) => {
      return ua.browserName === 'Chrome';
    });

    if (params.dir) {
      folder = kernel.api.filePath(params.dir, req.cwd)
      await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
      dl = new DownloaderHelper(url, folder, {
        headers: {
          "user-agent": userAgent,
        },
//        httpsRequestOptions: {
//          rejectUnauthorized: false
//        },
        override: {
          skip: true,
          skipSmaller: false,
        },
        resumeIfFileExists: true,
        removeOnStop: false,
        removeOnFail: false,
        retry: { maxRetries: 10, delay: 5000 },
      })
    } else if (params.path) {
      let filepath = kernel.api.filePath(params.path, req.cwd)
      folder = path.dirname(filepath)
      await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
      let filename = path.basename(filepath)
      dl = new DownloaderHelper(url, folder, {
        headers: {
          "user-agent": userAgent,
        },
//        httpsRequestOptions: {
//          rejectUnauthorized: false
//        },
        override: {
          skip: true,
          skipSmaller: false,
        },
        fileName: filename,
        resumeIfFileExists: true,
        removeOnStop: false,
        removeOnFail: false,
        retry: { maxRetries: 10, delay: 5000 },
      })
    }
    ondata({ raw: `\r\nDownloading ${url} to ${folder}...\r\n` })
    let res = await new Promise((resolve, reject) => {
      dl.on('end', () => {
        console.log('Download Completed');
        ondata({ raw: `\r\nDownload Complete!\r\n` })
        resolve()
      })
      dl.on('error', (err) => {
        console.log('Download Error', err)
        ondata({ raw: `\r\n[Download Error] ${err.stack}!\r\n` })
        reject(err)
      })
      dl.on('progress', (stats) => {
        let p = Math.floor(stats.progress)
        let str = ""
        for(let i=0; i<p; i++) {
          str += "#"
        }
        for(let i=p; i<100; i++) {
          str += "-"
        }
        ondata({ raw: `\r${str}` })
      })
      dl.on('download', (downloadInfo) => {
        const msg = `\r\n[Download Started] ${JSON.stringify({ name: downloadInfo.fileName, total: downloadInfo.totalSize })}\r\n`
        ondata({ raw: msg })
      })
      dl.on('skip', (skipInfo) => {
        const msg = `\r\n[Download Skipped] File already exists: ${JSON.stringify(skipInfo)}\r\n`
        ondata({ raw: msg })
        resolve()
      })
      dl.on('retry', (attempt, opts, err) => {
        const msg = "\r\n[Retrying] " + JSON.stringify({
          RetryAttempt: `${attempt}/${opts.maxRetries}`,
          StartsOn: `${opts.delay / 1000} secs`,
          Reason: err ? err.message : 'unknown'
        }) + "\r\n";
        ondata({ raw: msg })
      })
      dl.on('stateChanged', (state) => {
        const msg = "\r\n[State changed] " + state + "\r\n"
        ondata({ raw: msg })
      })
      dl.on('redirected', (newUrl, oldUrl) => {
        const msg = `\r\n[Redirected] '${oldUrl}' => '${newUrl}'\r\n`
        ondata({ raw: msg })
      })

      dl.start().catch((err) => {
        ondata({ raw: `\r\n[Download Failed] ${err.stack}!\r\n` })
        reject(err)
      })
    })
  }
  async downloadOne(req, ondata, kernel) {
    await retry(async (bail, number) => {
      ondata({ raw: `\r\n[Attempt ${number}]` })
      await this._download(req, ondata, kernel)
      ondata({ raw: "\r\nDone\r\n" })
    }, {
      retries: 10,
      factor: 2
    })
  }
  async download (req, ondata, kernel) {
    let params = req.params
    let url = params.url || params.uri
    if (Array.isArray(url) && params.dir) {
      ondata({ raw: "\r\nURIs:\r\n" + JSON.stringify(url, null, 2).replace(/\n/g, "\r\n") })
      for(let i=0; i<url.length; i++) {
        let u = url[i]
        ondata({ raw: `\r\n[${i+1}/${url.length}] Downloading ${u}\r\n` })
        req.params.url = u
        await this.downloadOne(req, ondata, kernel)
      }
    } else {
      await this.downloadOne(req, ondata, kernel)
    }

  }
}
module.exports = FS
