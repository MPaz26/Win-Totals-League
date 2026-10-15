FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Hot-reload dev server (used by compose.dev.yaml).
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM deps AS build
# Vite inlines VITE_* at build time; the anon key is public by design (RLS protects the data).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
COPY . .
RUN npm run build

# Serves the same static build GitHub Pages does, for checking a production build locally.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
