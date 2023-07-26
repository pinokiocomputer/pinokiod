const fs = require('fs');
const deserialize = require('child_process').deserialize;
process.on('message', (message) => {

  const { method, args } = message

  for(let i=0; i<args.length; i++) {
    let arg = args[i]
    if (arg && arg.hasOwnProperty('type') && arg.hasOwnProperty('data')) {
      if (arg.type === "Buffer") {
        args[i] = Buffer.from(arg.data)
      }
    }
  }

  if (method === "exists") {
    fs.promises.access(...args).then((result) => {
      process.send({ result: true })
    }).catch((e) => {
      process.send({ result: false })
    })
  } else {
    fs.promises[method](...args).then((result) => {
      process.send({ result })
    }).catch((e) => {
      process.send({ error: e })
    })
  }

})
