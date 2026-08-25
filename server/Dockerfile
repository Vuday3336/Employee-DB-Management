# Portable alternative to the Render blueprint — any host that runs a container
# (Fly.io, Railway, Cloud Run, ECS) can use this.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first so a source-only change reuses the cached layer.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Don't run as root.
USER node

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
