const child_process = require('child_process')
module.exports = async (req, ondata, kernel) => {
  /*
    req := {
      method: "exec",
      params: {

        // pinokio params
        message: <message>,
        path: <path>,

        // node.js child_process.exec params

        // Working directory
        cwd: '/path/to/working/directory',
        
        // Environment variables
        env: { ...process.env, CUSTOM_VAR: 'value' },
        
        // Encoding for stdout/stderr (default: 'utf8')
        encoding: 'utf8', // or 'buffer', 'ascii', etc.
        
        // Shell to execute the command
        shell: '/bin/bash', // default varies by platform
        
        // Timeout in milliseconds
        timeout: 10000, // Kill process after 10 seconds
        
        // Maximum buffer size for stdout/stderr
        maxBuffer: 1024 * 1024, // 1MB (default: 1024 * 1024)
        
        // Signal to send when killing due to timeout
        killSignal: 'SIGTERM', // default: 'SIGTERM'
        
        // User identity (Unix only)
        uid: 1000,
        gid: 1000,
        
        // Windows-specific options
        windowsHide: true, // Hide subprocess console window on Windows
        windowsVerbatimArguments: false // Quote handling on Windows

      }
    }
  */
  if (req.params && req.params.message) {
    // if cwd exists, use cwd
    // if cwd doesn't exist, set pat
    if (!req.params.cwd && req.params.path) {
      req.params.cwd = req.params.path
    }
    req.params.env = Object.assign({}, kernel.envs, req.params.env)
    console.log("env", JSON.stringify(req.params.env, null, 2))
    ondata({ raw: `██ Exec: ${req.params.message}\r\n` })
    let response = await new Promise((resolve, reject) => {
      child_process.exec(req.params.message, req.params, (error, stdout, stderr) => {
        resolve({
          stdout,
          error,
          stderr
        })
      })
    })
    console.log({ response })
    return response
  }
}
