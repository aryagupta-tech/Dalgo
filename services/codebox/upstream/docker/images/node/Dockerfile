FROM node:18-slim

# Node image already has user 'node' with UID 1000, use it
# Install additional tools
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*

# Create working directory
RUN mkdir -p /box && chown node:node /box

# Set working directory
WORKDIR /box

# Switch to non-root user
USER node

# Keep container alive (will be overridden at runtime)
CMD ["sleep", "infinity"]
