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

# Copy application code
COPY . .

# Build the app
RUN npm run build

# Create data directory for CSV exports and config
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 80

# Start the server
CMD ["npm", "run", "docker-start"]
