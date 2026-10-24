# Node 24 runs TypeScript directly (type stripping), so there's no build step.
# Built from the repo root (`docker build -f jobs/Dockerfile .`) so it can include the ESPN
# code shared with the update-scores Edge Function, at the same relative path.
FROM node:24-alpine
WORKDIR /app/jobs
COPY jobs/package.json jobs/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY supabase/functions/_shared /app/supabase/functions/_shared
COPY jobs/src ./src
CMD ["node", "src/update-standings.ts"]
