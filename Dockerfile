FROM node:22-alpine
WORKDIR /app
COPY server ./server
COPY package.json ./
ENV NODE_ENV=production HOST=0.0.0.0 STORE_FILE=/data/store.json
EXPOSE 8787
CMD ["node", "server/index.mjs"]
