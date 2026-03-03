# Gunakan Node versi LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json dulu (biar layer caching optimal)
COPY package*.json ./

# Install dependency
RUN npm install --production

# Copy source code
COPY . .

# Expose port
EXPOSE 3030

# Jalankan app
CMD ["node", "index.js"]