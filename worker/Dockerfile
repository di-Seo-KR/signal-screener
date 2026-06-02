# Zepta 발굴 워커 — Hetzner 전용 박스용 [P4]
# 빌드: 레포 루트에서  docker build -f worker/Dockerfile -t zepta-discovery .
# 실행: docker run -d --restart=always --env-file worker/.env --name zepta-discovery zepta-discovery
FROM node:20-slim

WORKDIR /app

# 의존성 먼저 (캐시 활용) — @vercel/kv 등 런타임 deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# 발굴에 필요한 코드만 (frontend 제외)
COPY api ./api
COPY worker ./worker

# 헬스: 단순 프로세스. 로그는 stdout.
CMD ["node", "worker/discovery-worker.mjs"]
