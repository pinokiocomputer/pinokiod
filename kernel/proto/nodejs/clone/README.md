# Clone a node.js project

## What it does

Sets up a project for a node.js server app.

1. Clones the given git URL into `app`.
2. Runs `npm install` inside the `app` folder to auto-install.
3. One click start launcher that runs `npm start` inside the `app` folder.

## Usage

To automatically launch the app in a browser, make sure:

- In your app, print the URL of the server after it starts.
- Pinokio will automatically detect the printed URL from the terminal and launch the app in a new tab.
