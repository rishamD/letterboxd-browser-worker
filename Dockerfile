FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Environment defaults
EXPOSE 8081

# Run using the production script
CMD ["npm", "run", "prod"]