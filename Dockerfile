# Multi-stage Dockerfile for Render with Chrome + Python support
FROM node:18-bullseye AS base

# Install system dependencies for Chrome and Python
RUN apt-get update && apt-get install -y \
    wget \
    gnupg2 \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    python3 \
    python3-pip \
    openssl \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for scrapers
RUN pip3 install --no-cache-dir \
    selenium==4.15.2 \
    undetected-chromedriver==3.5.4 \
    groq==0.4.2 \
    pandas==2.1.4 \
    pyperclip==1.8.2

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including dev dependencies needed for build)
RUN npm install --no-audit --no-fund && npm cache clean --force

# Generate Prisma Client
RUN npx prisma generate

# Copy application code
COPY . .

# Build the NestJS application
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Create directories for uploads and Chrome profile
RUN mkdir -p uploads /tmp/chrome_profile

# Expose port 3001 (Backend default)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT:-3001}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start command - run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]