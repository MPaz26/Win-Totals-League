# Node 24 runs TypeScript directly (type stripping), so there's no build step.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY src ./src
CMD ["node", "src/update-standings.ts"]
