FROM node:20-alpine

WORKDIR /app

# 의존성 먼저 (캐시 최적화)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 소스 복사
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
