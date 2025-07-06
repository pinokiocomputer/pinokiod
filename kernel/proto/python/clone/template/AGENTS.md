# TODO
- When instructed to build app, write the app code, and also write a pinokio launcher to launch the app.

# App
- When instructed to build app, write the app logic inside the `app` folder.
- The app logic should stay strictly inside the `app` folder.

# Launcher
- Generate a Pinokio launcher in the root folder following the documentation in `PINOKIO.md`
- The launcher files should be in the root project root folder.
- Create a start script to launch the app.
- If the project requires an install step, create an install script as well.
- To determine which files to generate, refer to the "Programming Pinokio" section in the `PINOKIO.md` file.
- To be more precise, you will need at least a `pinokio.json` file for the dispay, `pinokio.js` file for the launcher, and indidual script files which are referenced from the `pinokio.js` file.
- Also, refer to the "Dynamic menu rendering" section to render the launcher menu dynamically, so it sets the default script to the install script when installing, start script when starting the app, and in case there's a web UI, make the web UI URL the default, so the dynamic menu automatically selects the web URL when the app has finished launching.

# Script
- When writing shell commands in scripts using the `shell.run` API, the commands must be cross platform.
- Try to minimize the actual shell command used. This can be achieved by utilizing all the available parameters provided by `shell.run` API.
- Python apps must run in virtual environments, which can be run by running `shell.run` with a `venv` attribute to create or use a virtual environment at specific path

# Tools
- When installing python packages, use UV, it's already installed.
- When installing NPM packages, use pnpm, it's already installed.
