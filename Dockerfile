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
        git \
        lsof \
        net-tools \
        openssh-client \
        p7zip-full \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY . .

EXPOSE 42000
CMD ["npm", "start"]
