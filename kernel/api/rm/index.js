const path = require('path')
const fs = require('fs')
const rm = (old, keys) => {
  for (let key of keys) {
    try {
//      let fun = new Function('old', 'key', `delete old.${key}; return old;`);
//      old = fun(old, key);
      let keypath = String(key).split(".")
      // multiple keys. check if that path exists.
      // if not, create the path
      let next = old
      for(let i=0; i<keypath.length; i++) {
        if (i === keypath.length-1) {
          // last
          let path_key = keypath[i]
          if (/^[0-9]+$/.test(path_key)) {
            if (Array.isArray(next)) {
              // array index
              let index = Number(path_key)
              next.splice(index, 1)
            }
          } else {
            // key
            delete next[path_key]
          }
        } else {
          const key = keypath[i];
          next = next[key];
        }
      }
    } catch (e) {
    }
  }
  return old;
};
module.exports = async (req, ondata, kernel) => {
  /*
    {
      method: "rm",
      root: <uri>,
      params: {
        local: [<key>, <key>, ...],
        global: [<key>, <key>, ...],
        self: [<key>, <key>, ...]
      }
    }
  */

  // set the local and global variables
  let types = ["local", "global"]
  for(let type of types) {
    let keys = req.params[type]
    if (keys) {
      let old = kernel.memory[type][req.parent.path]
      old = rm(old, keys)
      kernel.memory[type][req.parent.path] = old

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
        [ "attr", "a.b.c" ]
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


        old = rm(old, kv)

        // write to the filepath

        await fs.promises.writeFile(filepath, JSON.stringify(old, null, 2))
      }
    }
  }
}
