FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/missrinam80-besc/besc-discordbot"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/state && chown node:node /app/state
USER node
CMD ["node", "dist/main.js"]
