FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY config.js index.js tui.js telegram.js ./

ENV HEADLESS=true

CMD ["node", "index.js", "--headless"]
