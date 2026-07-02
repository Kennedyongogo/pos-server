FROM node:lts-slim

WORKDIR /usr/src/app

# Native build for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --silent

COPY . ./

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

CMD ["node", "src/server.js"]
