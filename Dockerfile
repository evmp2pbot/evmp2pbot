FROM node:20-slim

# Create App directory in Container
WORKDIR /usr/src/app

# Install App dependencies
COPY package*.json ./
RUN npm install

# Copy bundle App source
COPY . .
RUN npm run build

# Run App
CMD ["npm", "start"]
