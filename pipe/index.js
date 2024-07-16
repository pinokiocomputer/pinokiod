const { createProxyMiddleware } = require('http-proxy-middleware');
const { red, yellow, green, blue  } = require('kleur');

const path = require('path')
const { createHttpTerminator } = require('http-terminator')
const express = require('express')
const session = require('express-session');
//const bcrypt = require('bcrypt');
const cors = require('cors');
class Pipe {
  constructor(kernel) {
    this.kernel = kernel
    this.terminators = {}
    this.procs = {}
  }
  authenticate (req, res, next) {
    if (req.session.authenticated) {
      next();
    } else {
      res.redirect('/pinokio/login');
    }
  }
  // a pipe server for creating publicly shareable endpoints
  async start(url, scriptPath, passcode, config) {
    console.log("pipe.start", { url, scriptPath, passcode, config })

    let port = await this.kernel.port()
    let app = express();
    app.use(cors({ origin: '*' }));
    app.use(express.urlencoded({ extended: true }));
    app.set('view engine', 'ejs');
    app.set("views", path.resolve(__dirname, "views"))
//    app.use(express.static(path.resolve(__dirname, 'public')));
    app.use(session({
      secret: 'oikonip',
      resave: false,
      saveUninitialized: true
    }));
    app.get('/pinokio/login', (req, res) => {
      res.render("login", { error: null, ...config })
    });

    app.post('/pinokio/login', async (req, res) => {
      
      const { password } = req.body;
      
      //if (await bcrypt.compare(password, hashedPassword)) {

      // multiple passcode options supported (comma separated)
      let passcode_options = passcode.split(",")
      if (passcode_options.includes(password)) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const agent = req.headers['user-agent']
        let event = {
          time: `${new Date().toLocaleString()}`,
          ip,
          agent
        }
        this.kernel.api.ondata({
          id: scriptPath,
          type: "notify",
          data: {
            silent: true,
            html: `<div><b>[${password}] ${event.ip}</b><br><div>${event.time}</div><div>${event.agent}</div>`
          }
        })

        let passcode_log = red(password)
        let timestamp_log = yellow(event.time)
        let ip_log = blue(event.ip)
        let browser_log = event.agent
        this.kernel.api.ondata({
          type: "stream",
          kernel: true,
          id: scriptPath,
          data: {
            raw: `\r\n[${passcode_log}]\t${timestamp_log}\t${ip_log}\t${browser_log}\r\n`
          }
        })
        req.session.authenticated = true;
        res.redirect('/');
      } else {
        res.status(401).render("login", { error: "Invalid passcode", ...config })
      }
    });

    app.get('/pinokio/logout', (req, res) => {
      req.session.authenticated = false;
      res.redirect('/login');
    });


    const proxy = createProxyMiddleware({
      pathFilter: '/',
      target: url,
      ws: true
    })

    app.use('/', this.authenticate, proxy)


    await new Promise((resolve, reject) => {
      console.log("starting pipe server at port", port)
      let server = app.listen(port, () => {
        console.log(`Pipe server listening on port ${port}`)
        resolve()
      });
      let terminator = createHttpTerminator({ server });
      this.terminators[url] = terminator
    })
    let pipe_uri = `http://localhost:${port}`

    // original url => pipe url
    if (!this.procs[scriptPath]) {
      this.procs[scriptPath] = {}
    }
    this.procs[scriptPath][url] = pipe_uri
    return pipe_uri
  }
  async stop(url, scriptPath) {
    console.log("stop pipe", { scriptPath, url, terminator: this.terminators[url] })
    if (this.terminators[url]) {
      await this.terminators[url].terminate()
      delete this.terminators[url]
      delete this.procs[scriptPath][url]
    }
  }
}
module.exports = Pipe
