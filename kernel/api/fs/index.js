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


class FS {
  async read(req, ondata, kernel) {
    /*
      params := {
        path: <filepath>,
        encoding: "ascii"|"base64"|"base64url"|"hex"|"utf8"|"utf-8"|"binary"
      }
    */
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let filepath = path.resolve(cwd, req.params.path)
    let data = await fs.promises.readFile(filepath, req.params.encoding)
    return data
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
    /////////////////////////////////////////////////////////////////////////////

    console.log("fs.share", req.params)

    ondata({ raw: "\r\ncreating a shared drive:\r\n" + JSON.stringify(req.params, null, 2).replace(/\n/g, "\r\n") })

    if (req.params.drive) {
      const drivePath = kernel.path("drive")
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
      console.log("call drive.create")
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
    let filepath = path.resolve(cwd, req.params.path)
//    await fs.promises.rm(filepath)
    ondata({ raw: "\r\nremoving:\r\n" + filepath + "\r\n" })
    await rimraf(filepath)
    ondata({ raw: "done\r\n" })
  }
  async copy(req, ondata, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let src = path.resolve(cwd, req.params.src)
    let dest = path.resolve(cwd, req.params.dest)
    let options = req.params.options
    ondata({ raw: "\r\ncopying:\r\nfrom: " + src + "\r\nto: " + dest + "\r\n" })
    await fs.promises.cp(src, dest, options)
    ondata({ raw: "done\r\n" })
  }

  async init(req, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let filepath = path.resolve(cwd, req.params.path)
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
        await fs.promises.appendFile(filepath, Strin(req.params.join), "utf8")
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
        delimiter: {                                         // used when the data is an array 
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


    // 3. if array, iterate through the data and append
    if (Array.isArray(data)) {
      let chunks = data
      for(let i=0; i<chunks.length; i++) {
        let chunk = chunks[i]

        await this._append(filepath, chunk, type)
        // 3.2. if there's a delimiter, append the delimiter (EXCEPT for the last item)
//        if (i < chunks.length-1) {
          await this._delimit(req, filepath)
//        }

      }
    } else {
      // 4. if not array, just append once
      await this._append(filepath, data, type)
    }

  }
  async write (req, ondata, kernel) {
    /*
      params := {
        path: <filepath>,
        <json|buffer|text>: ___,
        delimiter: {                                                        // used when the data is an array 
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
    console.log("userAgent", userAgent)

    if (params.dir) {
      folder = kernel.api.filePath(params.dir, req.cwd)
      console.log("folder", folder)
      await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
      dl = new DownloaderHelper(url, folder, {
        headers: {
          "user-agent": userAgent,
        },
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
      console.log("folder", folder)
      await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
      let filename = path.basename(filepath)
      dl = new DownloaderHelper(url, folder, {
        headers: {
          "user-agent": userAgent,
        },
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
        console.log(msg)
        ondata({ raw: msg })
      })
      dl.on('skip', (skipInfo) => {
        const msg = `\r\n[Download Skipped] File already exists: ${JSON.stringify(skipInfo)}\r\n`
        console.log(msg)
        ondata({ raw: msg })
        resolve()
      })
      dl.on('retry', (attempt, opts, err) => {
        const msg = "\r\n[Retrying] " + JSON.stringify({
          RetryAttempt: `${attempt}/${opts.maxRetries}`,
          StartsOn: `${opts.delay / 1000} secs`,
          Reason: err ? err.message : 'unknown'
        }) + "\r\n";
        console.log(msg)
        ondata({ raw: msg })
      })
      dl.on('stateChanged', (state) => {
        const msg = "\r\n[State changed] " + state + "\r\n"
        console.log(msg)
        ondata({ raw: msg })
      })
      dl.on('redirected', (newUrl, oldUrl) => {
        const msg = `\r\n[Redirected] '${oldUrl}' => '${newUrl}'\r\n`
        console.log(msg)
        ondata({ raw: msg })
      })

      dl.start().catch((err) => {
        console.log('Download Failed', err)
        ondata({ raw: `\r\n[Download Failed] ${err.stack}!\r\n` })
        reject(err)
      })
    })
  }
  async download (req, ondata, kernel) {
    await retry(async (bail, number) => {
      ondata({ raw: `\r\n[Attempt ${number}]` })
      console.log("trying", number)
      await this._download(req, ondata, kernel)
      console.log("success")
      ondata({ raw: "\r\nDone\r\n" })
    }, {
      retries: 10,
      factor: 2
    })

  }
}
module.exports = FS
