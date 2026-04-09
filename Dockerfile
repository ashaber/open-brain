FROM node:20-alpine

# non-root user (per global standards)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# copy package files first — layer caching means npm install
# only reruns when dependencies change, not on every code change
COPY package*.json ./
RUN npm ci --omit=dev

# copy source
COPY mcp-server.js ./

# switch to non-root
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "mcp-server.js"]