# Use the official Playwright image which includes necessary system dependencies
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies like pm2 for the build stage)
RUN npm install

# Ensure Playwright browsers are installed (though usually included in the base image)
RUN npx playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

# Expose the port defined in your ecosystem.config.js
EXPOSE 8081

# Use PM2 to run the application as defined in your package.json prod script
# This handles the cluster mode defined in your ecosystem.config.js
CMD ["npm", "run", "prod"]