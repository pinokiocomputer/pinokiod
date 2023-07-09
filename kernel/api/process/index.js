class Process {
  async wait (req, ondata, kernel) {
    /*
    params := {
      <sec>|<min>: <num>
    }
    */
    let ms 
    if (req.params) {
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
    } else {
      await new Promise((resolve, reject) => {
        this.resolve = resolve
      })
    }
  }
}
module.exports = Process
