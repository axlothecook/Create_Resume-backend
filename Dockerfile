# Node.js 22 LTS on a slim Linux base (smaller image, fewer unused packages).
FROM node:22-slim

WORKDIR /app

# Copy only the dependency manifests first so Docker can cache the install layer:
# if the source changes but package*.json don't, the npm ci layer below is reused.
COPY package.json package-lock.json ./

# Clean, reproducible install straight from the lockfile. --omit=dev drops
# devDependencies (jest, supertest, mongodb-memory-server, nodemon) — the
# production image only needs runtime deps.
RUN npm ci --omit=dev

# Copy the rest of the source. .dockerignore excludes node_modules, .env, tests, etc.
COPY . .

# Run as the unprivileged 'node' user that the base image already provides.
USER node

# Metadata only — the API listens on 3006 (publish at run time with -p / compose).
EXPOSE 3006

# Plain node (NOT npm run dev / nodemon, which is a dev-only file watcher).
CMD ["node", "app.js"]
