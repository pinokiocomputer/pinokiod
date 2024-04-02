const waitOn = require('wait-on');
class Process {
//  async start(req, ondata, kernel) {
//    /*
//      req := {
//        method: "process.start",
//        params: {
//          uri: "https://github.com/cocktailpeanutlabs/comfyui.git/start.js",
//          html: "please install ollama",
//        }
//      }
//    */
//    if (kernel.running(req.params.uri)) {
//      // nothing
//    } else {
//      // if exists
//      let uri = req.params.uri
//      let filePath = kernel.api.filePath(uri)
//      if (kernel.exists(filePath)) {
//        // run script
//        await kernel.api.init()
//        console.log("start process", uri)
//        await kernel.api.process({ uri })
//        console.log("process finished")
//      } else {
//        // display html notify
//        let repo = new URL(uri)
//        let href = `https://pinokio.computer/item?uri=${repo}`
//        ondata({
//          html: req.params.html,
//          href,
//          target: "_blank",
//        }, "notify")
//      }
//    }
//  }
//  async run (req, ondata, kernel) {
//    /*
//      // if uri is not specified => just wait
//      req := {
//        method: "process.wait",
//        params: {
//          wait: <waitOn object>,
//          href: "https://ollama.com",
//          html: "please install ollama",
//        }
//      }
//
//      // if uri is specified => it's pinokio script
//      1. if the wait condition is met => return immediately
//      2. if the wait condition is not met
//        2.1. if the script exists
//          run the script
//          and wait for the wait condition
//        2.2. if the script does not exist
//          display the 'message' and the 'link'
//
//      req := {
//        method: "process.wait",
//        params: {
//          start: "https://github.com/cocktailpeanutlabs/comfyui.git/start.js",
//          wait: <waitOn object>,
//          html: "start comfyui",
//        }
//      }
//    */
//
//    if (req.params) {
//      if (req.params.wait) {
//
//        await new Promise((resolve, reject) => {
//          let options = req.params.wait
//          waitOn(options).then(() => {
//            resolve()
//          })
//
//          // 1. if there's a script attribute
//          //  1.0. check if the script repo exists
//          //    => if exists, go to the next step
//          //    => if not exists, display the message and the link
//          //  1.1. check if the script is running
//          //    => if running, don't do anything => waitOn() will automatically return
//          //    => if not running, start the script
//          //  1.2. check if the script is not repo exists
//          // 2. if there's no script attribute => display the message and the link
//          if (req.params.start) {
//            if (kernel.running(req.params.start)) {
//              // nothing
//            } else {
//              // if exists
//              let uri = req.params.start
//              let filePath = kernel.api.filePath(uri)
//              if (kernel.exists(filePath)) {
//                // run script
//                //await kernel.api.init()
//                kernel.api.process({ uri })
//              } else {
//                // display html
//                let repo = new URL(uri)
//                let href = `https://pinokio.computer/item?uri=${repo}`
//                ondata({
//                  html: req.params.html,
//                  href,
//                  target: "_blank",
//                }, "notify")
//              }
//            }
//          } else {
//            ondata({
//              html: req.params.html,
//              href: req.params.href,
//              target: "_blank",
//            }, "notify")
//          }
//        })
//      }
//    }
//
//
//
//
//
//  }
  async wait (req, ondata, kernel) {
    /*
    params := {
      sec: <SECONDS>,
      message: (optional) Description to display while waiting,
      menu: (optional) menu to display in the modal while waiting,
//      ok: (optional) <ok button text> (if not specified, no ok button),
//      cancel: (optional) <cancel button text> (if not specified, no cancel button)
    }

    or 

    params := {
      min: <MINUTES>,
      message: (optional) Description to display while waiting,
      menu: (optional) menu to display in the modal while waiting,
//      ok: (optional) <ok button text> (if not specified, no ok button),
//      cancel: (optional) <cancel button text> (if not specified, no cancel button)
    }

    or

    params := {
      on: <wait-on condition https://github.com/jeffbski/wait-on>,
      message: (optional) Description to display while waiting,
      menu: (optional) menu to display in the modal while waiting,
//      ok: (optional) <ok button text> (if not specified, no ok button),
//      cancel: (optional) <cancel button text> (if not specified, no cancel button)
    }


    if 'ok' is pressed before the condition is met, goes to the next step
    if 'cancel' is pressed before the condition is met, stops the script

    */
    let ms 
    if (req.params) {
      // Display modal
      if (req.params.sec || req.params.min) {
        // Wait
        if (req.params.sec) {
          ms = req.params.sec * 1000
        } else if (req.params.min) {
          ms = req.params.min * 60 * 1000
        }
        await new Promise((resolve, reject) => {
          this.resolve = resolve

          // register the process with the root uri so it can be manually resolved (with this.resolve()) later
          kernel.procs[req.parent.path] = this

          setTimeout(() => {
            this.resolve()
          }, ms)
        })
      } else if (req.params.on) {
        // Wait
        if (req.params.message) {
          ondata({
            raw: `\r\nWaiting: ${JSON.stringify(req.params.on)}\r\n`
          })
          ondata(req.params, "wait")
        }
        console.log("Wait", req.params.on)
        await waitOn(req.params.on)
        console.log("Wait finished")
        ondata(req.params, "wait.end")
      }
    } else {
      await new Promise((resolve, reject) => {
        this.resolve = resolve
      })
    }
  }
}
module.exports = Process
