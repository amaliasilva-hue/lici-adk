# ── Stage 1: install deps ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Runtime env vars are injected at deploy time via Cloud Run;
# set a placeholder so next build doesn't fail on missing vars.
ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_URL=http://localhost:8000

# Firebase web config (public by design — client-side SDK)
ENV NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCKEpr6fQVQHtrYe4rNHuPkjJebZn0ePBQ
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=operaciones-br.firebaseapp.com
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=operaciones-br
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=operaciones-br.firebasestorage.app
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=789640198008
ENV NEXT_PUBLIC_FIREBASE_APP_ID=1:789640198008:web:9506ae861e435007fb7a8d

RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
