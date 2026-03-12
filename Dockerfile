FROM node:20-alpine

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Cache-busting: CapRover passes git commit SHA, forcing rebuild when code changes
ARG CAPROVER_GIT_COMMIT_SHA
ENV APP_VERSION=${CAPROVER_GIT_COMMIT_SHA:-dev}
RUN echo "Building commit: ${CAPROVER_GIT_COMMIT_SHA:-dev}"

# Copy application code (now rebuilds when commit SHA changes)
COPY . .

# Write version info to file for runtime access
RUN echo "{\"commit\":\"${CAPROVER_GIT_COMMIT_SHA:-dev}\",\"buildTime\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /app/version.json

# Build the app
RUN npm run build

# Create data directory for CSV exports and config
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 80

# Start the server
CMD ["npm", "run", "docker-start"]
