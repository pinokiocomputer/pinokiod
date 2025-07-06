# Set up a new python server project with Pytorch

## What it does

This sets up a project for a python server app that uses Pytorch.

1. Creates an `app` folder
2. Creates an empty `app/app.py` file
3. Creates an empty `app/requirements.txt` file
4. Adds basic launcher script for installing the `requirements.txt` file and running the `app.py` file.
5. Automatically install the correct version of PyTorch based on the platform.

## Usage

To automatically launch the app in a browser, make sure:

- In your app, print the URL of the server after it starts.
- Pinokio will automatically detect the printed URL from the terminal and launch the app in a new tab.
