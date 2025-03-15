# Use the NVIDIA CUDA base image with cuDNN support
FROM nvidia/cuda:12.2.2-base-ubuntu22.04

# Install necessary packages
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    curl \
    build-essential \
    xvfb \
    && rm -rf /var/lib/apt/lists/*


# Set up X Virtual Framebuffer
ENV DISPLAY=:99
RUN Xvfb :99 -screen 0 1920x1080x24 &

# Install nvm
ENV NVM_DIR /usr/local/nvm
RUN mkdir -p $NVM_DIR
ENV NODE_VERSION 22.14.0
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm use $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && ln -s $NVM_DIR/versions/node/v$NODE_VERSION/bin/node /usr/local/bin/node \
    && ln -s $NVM_DIR/versions/node/v$NODE_VERSION/bin/npm /usr/local/bin/npm

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy all files from the parent directory, excluding the Docker directory
COPY . .


# Create pinokio.json file in the script directory with the home directory set

RUN mkdir -p /root/config

RUN echo '{"home": "/root/pinokio"}' > /root/config/pinokio.json

RUN ln -s /root/config/pinokio.json /app/script/pinokio.json

COPY Docker/.bashrc /root/.bashrc

# Expose the port that the application will run on
EXPOSE 41999

# Patch server script to not display in window
RUN sed -i '1s|^|global.window = global.window \|\| {}; global.window.location = { href: \"http://localhost\" }; \n|' /app/script/index.js



# Start the application
CMD ["npm", "start"]

