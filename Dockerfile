FROM mcr.microsoft.com/playwright:v1.44.0-focal
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 8081
CMD ["node", "src/server.js"]