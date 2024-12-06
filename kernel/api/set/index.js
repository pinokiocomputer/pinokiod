const path = require('path')
const fs = require('fs')
const set = async (old, kv, kernel, req, ondata) => {
  if (Array.isArray(kv)) {
    old = kv
  } else {
    for (let key in kv) {
      try {
        if (key.startsWith('[')) {
          // array
          let fun = new Function(
            'old',
            'key',
            'val',
            `old${key} = val; return old;`
          );
          old = fun(old, key, kv[key]);
        } else {

          let keypath = key.split(".")
          // multiple keys. check if that path exists.
          // if not, create the path
          let next = old
          for(let i=0; i<keypath.length; i++) {
            if (i === keypath.length-1) {
              // last
              next[keypath[i]] = kv[key]
            } else {
              const key = keypath[i];
              if (!(key in next)) {
                next[key] = {}
              }
              next = next[key];
            }
          }

  //        let fun = new Function(
  //          'old',
  //          'key',
  //          'val',
  //          //`old.${key} = val; return old;`
  //          `old["${key}"] = val; return old;`
  //        );
  //        old = fun(old, key, kv[key]);
        }


  //      // reserved variable: "url"
  //      if (key === "url") {
  //        // start proxy
  //        ondata({
  //          raw: `\r\n[Start proxy] ${kv[key]}\r\n`
  //        })
  //        let response = await kernel.api.startProxy(req.parent.path, kv[key], "Shared")
  //        console.log("Response", response)
  //        ondata({
  //          raw: `Proxy Started ${JSON.stringify(response)}\r\n`
  //        })
  //      }
      } catch (e) {
      }
    }
  }
  return old
}
module.exports = async (req, ondata, kernel) => {
  /*
    {
      root: <parent uri>,
      params: {
        local: {
          <key>: <val>,
          <key>: <val>
        },
        global: {
          <key>: <val>,
          <key>: <val>
        },
        self: {
          <filepath>: {
            <key>: <val>,
          }
        },
        key: {
          <host uri>: {
            <key>: <val>
          }
        }
      }
    }
  */

  // set the local and global variables
  let types = ["local", "global"]
  for(let type of types) {
    let kv = req.params[type]
    if (kv) {

      let old = kernel.memory[type][req.parent.path]
      if (!old) {
        old = {}
      }
      old = await set(old, kv, kernel, req, ondata)
      kernel.memory[type][req.parent.path] = old

//      if (!kernel.memory[type][req.uri]) {
//        kernel.memory[type][req.uri] = {}
//      }
//      for(let key in kv) {
//        kernel.memory[type][req.uri][key] = kv[key]
//      }
    }
  }
  // set self => save to the file

/*
  {
    self: {
      // writing to self
      "index.json": {
        "abc": "def"
      },
      // writing to filepath
      "data/models.json": {
        "items[0]": "sdfasdfsdf",
        "[0]": "sdfsd",
        "attr": "xxx",
        "a.b.c": "xxx"
      }
    }
  }
  */

  let self = req.params.self
  if (!self) {
    self = req.params.json
  }
  if (self) {
    for(let relative_filepath in self) {
      let filepath = path.resolve(req.cwd, relative_filepath)
      // ensure that the filepath is .json
      if (filepath.endsWith(".json")) {
        // load the file
        let old = (await kernel.loader.load(filepath)).resolved
        if (!old) {
          old = {}
          // doesn't exist
          // if the folder doesn't exist, create one
          let folder = path.dirname(filepath)
          await fs.promises.mkdir(folder, { recursive: true }).catch((e) => { })
        }
        let kv = self[relative_filepath]

        old = await set(old, kv, kernel, req, ondata)

        // write to the filepath

        await fs.promises.writeFile(filepath, JSON.stringify(old, null, 2))
      }
    }
  }

/*
  {
    "method": "set",
    "params": {
      "key": {
        "https://twitter.com": {
          "abc": "def"
        },
      }
    }
  }
  */

  if (req.params.key) {
    let keypath = path.resolve(kernel.homedir, "key.json")
    let old = (await kernel.loader.load(keypath)).resolved
    if (!old) {
      old = {}
      // doesn't exist
    }
    for(let host_url in req.params.key) {

      let oldkv = old[host_url]
      if (!oldkv) oldkv = {}

      let newkv = req.params.key[host_url]

      oldkv = await set(oldkv, newkv, kernel, req, ondata)

      old[host_url] = oldkv

    }

    await fs.promises.writeFile(keypath, JSON.stringify(old, null, 2))

    kernel.keys = old
  }
}
