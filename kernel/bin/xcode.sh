#!/bin/bash

# Trigger the installation
xcode-select --install

open "/System/Library/CoreServices/Install Command Line Developer Tools.app"

# Wait for the "Install Command Line Developer Tools" process to start

echo -e "\033[0;31m>>> Waiting for the installation dialog to be confirmed."
echo -e ">>> Look for a dialog requesting the command line developer tools, and CLICK 'Install'..."
while ! pgrep "Install Command Line Developer Tools" > /dev/null; do
  sleep 1
done

echo "Installation in progress..."

# Wait for the installation process to finish
while pgrep "Install Command Line Developer Tools" > /dev/null; do
  sleep 1
done

echo "Installation completed."

# Switch to the installed Command Line Tools path
xcode-select -switch /Library/Developer/CommandLineTools

echo "Switched to Command Line Tools."
