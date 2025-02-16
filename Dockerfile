# Generated by https://smithery.ai. See: https://smithery.ai/docs/config#dockerfile
# Use a Node.js image for building
FROM node:22.12-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json for dependency installation
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --ignore-scripts

# Copy the source code
COPY src ./src
COPY tsconfig.json ./

# Build the server
RUN npm run build

# Prepare the final image
FROM node:22-alpine AS release

# Set the working directory
WORKDIR /app

# Copy the built files and package.json
COPY --from=builder /app/build /app/build
COPY --from=builder /app/package.json /app/package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Expose the necessary port
EXPOSE 8080

# Define environment variables
ENV SEQ_BASE_URL=http://localhost:8080
ENV SEQ_API_KEY=your-api-key

# Command to run the server
ENTRYPOINT ["node", "build/seq-server.js"]
