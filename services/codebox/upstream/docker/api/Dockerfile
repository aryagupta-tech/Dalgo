FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 3000

# API only queues jobs to Redis — no Docker or isolate needed
USER node

CMD ["node", "src/index.js"]
