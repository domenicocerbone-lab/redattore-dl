# Immagine per la pubblicazione online (Railway o qualsiasi host Docker).
# Conversazioni, foto, persone e registro d'uso stanno in /data: montaci un volume.
FROM node:22-slim
# Chromium di sistema per i PDF generati dal server (puppeteer-core non scarica browser).
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
ENV REDATTORE_CHROMIUM=/usr/bin/chromium
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production REDATTORE_DATI=/data
CMD ["npm", "start"]
