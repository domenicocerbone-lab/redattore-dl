# Immagine per la pubblicazione online (Railway o qualsiasi host Docker).
# Conversazioni, foto, persone e registro d'uso stanno in /data: montaci un volume.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production REDATTORE_DATI=/data
CMD ["npm", "start"]
