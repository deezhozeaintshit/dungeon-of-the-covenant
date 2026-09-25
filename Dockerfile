FROM node:20-alpine

WORKDIR /app

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy full game server and 3D WebGL client
COPY server ./server
COPY client ./client

# Ensure persistent data directory exists for cloud accounts
RUN mkdir -p /app/server/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/server.js"]
