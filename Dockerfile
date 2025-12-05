FROM node:18-bullseye-slim AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 8000 8080
CMD ["npm", "run", "start-prod"]
