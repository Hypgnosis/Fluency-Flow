FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js .

# Cloud Run provides PORT env var
EXPOSE 8080

CMD ["node", "index.js"]
