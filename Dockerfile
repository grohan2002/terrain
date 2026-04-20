FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install OpenTofu, Azure CLI, Trivy, and network utilities for deployment testing
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg lsb-release dnsutils netcat-openbsd unzip && \
    # -- OpenTofu --
    curl -fsSL https://get.opentofu.org/install-opentofu.sh -o install-opentofu.sh && \
    chmod +x install-opentofu.sh && \
    ./install-opentofu.sh --install-method deb && \
    rm install-opentofu.sh && \
    # -- Azure CLI --
    curl -sL https://aka.ms/InstallAzureCLIDeb | bash && \
    # -- Trivy --
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    # -- OPA (Open Policy Agent) --
    curl -sfL "https://openpolicyagent.org/downloads/latest/opa_linux_$(dpkg --print-architecture)" -o /usr/local/bin/opa && \
    chmod +x /usr/local/bin/opa && \
    # -- Infracost --
    curl -sfL https://raw.githubusercontent.com/infracost/infracost/master/scripts/install.sh | sh -s -- -b /usr/local/bin && \
    # -- Cleanup --
    apt-get purge -y gnupg lsb-release unzip && \
    apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /home/nextjs/.azure && chown -R nextjs:nodejs /home/nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
