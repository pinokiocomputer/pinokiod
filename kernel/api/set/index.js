const path = require('path')
const fs = require('fs')
const set = (old, kv) => {
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
        let fun = new Function(
          'old',
          'key',
          'val',
          `old.${key} = val; return old;`
        );
        old = fun(old, key, kv[key]);
      }
    } catch (e) {
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
      old = set(old, kv)
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

  if (req.params.self) {
    for(let relative_filepath in req.params.self) {
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
        let kv = req.params.self[relative_filepath]

        old = set(old, kv)

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

      oldkv = set(oldkv, newkv)

      old[host_url] = oldkv

      console.log("oldkv", oldkv)
    }

    console.log("set", old)
    await fs.promises.writeFile(keypath, JSON.stringify(old, null, 2))

    kernel.keys = old
  }
}
