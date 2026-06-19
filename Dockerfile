# Production image for pinokiod with required system tooling
FROM node:20 AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20 AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bluez \
        curl \
        git \
        lsof \
        net-tools \
        openssh-client \
        p7zip-full \
        pv \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Pre-seed the Pinokio dev preset into the image as a compressed archive
RUN mkdir -p /app/.pinokio-seed \
    && PINOKIO_HOME=/app/.pinokio-seed PINOKIO_SETUP_MODE=prod_dev node script/install-mode.js \
    && rm -rf /app/.pinokio-seed/network \
    && mkdir -p /app/.pinokio-seed/network \
    && git clone --depth 1 https://github.com/pinokiocomputer/network /app/.pinokio-seed/network/system \
    && rm -rf /app/.pinokio-seed/network/system/.git \
    && rm -rf /app/.pinokio-seed/plugin \
    && mkdir -p /app/.pinokio-seed/plugin \
    && git clone --depth 1 https://github.com/pinokiocomputer/code /app/.pinokio-seed/plugin/code \
    && rm -rf /app/.pinokio-seed/plugin/code/.git \
    && rm -rf /app/.pinokio-seed/prototype/system \
    && mkdir -p /app/.pinokio-seed/prototype \
    && git clone --depth 1 https://github.com/pinokiocomputer/proto /app/.pinokio-seed/prototype/system \
    && rm -rf /app/.pinokio-seed/prototype/system/.git \
    && curl -fsSL https://raw.githubusercontent.com/pinokiocomputer/home/refs/heads/main/docs/README.md -o /app/.pinokio-seed/prototype/PINOKIO.md \
    && curl -fsSL https://raw.githubusercontent.com/pinokiocomputer/pterm/refs/heads/main/README.md -o /app/.pinokio-seed/prototype/PTERM.md \
    && tar -C /app/.pinokio-seed -czf /app/.pinokio-seed.tgz . \
    && rm -rf /app/.pinokio-seed

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PINOKIO_HOME=/data/pinokio \
    PINOKIO_HTTPS_ACTIVE=1 \
    PINOKIO_NETWORK_ACTIVE=1
VOLUME ["/data/pinokio"]

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]
