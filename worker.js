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

  fs.promises[method](...args).then((result) => {
    console.log("RESULT", result)
    process.send({ result })
  }).catch((e) => {
    process.send({ error: e })
  })
})
