const path = require('path')
//const decompress = require('decompress');
const fs = require("fs")
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
  async rm(req, ondata, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let filepath = path.resolve(cwd, req.params.path)
    await fs.promises.rm(filepath)
  }
  async copy(req, ondata, kernel) {
    let cwd = (req.cwd ? req.cwd : kernel.api.userdir)
    let src = path.resolve(cwd, req.params.src)
    let dest = path.resolve(cwd, req.params.dest)
    let options = req.params.options
    await fs.promises.cp(src, dest, options)
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
  async download (req, ondata, kernel) {
    /*
      params := {
        url,
        path
      }
    */
    let params = req.params
    params.path = path.resolve(req.cwd, params.path)
    const res = await kernel.fetch(params.url);
    const totalLength = res.headers.get('content-length');
    // try to create the path
    let folder = path.dirname(params.path)
    await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
    const fileStream = fs.createWriteStream(params.path);
    let downloadedLength = 0;
    res.body.on('data', (chunk) => {
      downloadedLength += chunk.length;
      const percentage = ((downloadedLength / totalLength) * 100).toFixed(2);
      process.stdout.write(`Downloading... ${percentage}%\r`);
      if (ondata) ondata({ raw: `Downloading... ${percentage}%\r` });
    });
    res.body.pipe(fileStream);
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    // refresh api in case a new api was downloaded
    await kernel.api.init()
    return {
      size: downloadedLength,
      ...params
    }
  }
}
module.exports = FS
