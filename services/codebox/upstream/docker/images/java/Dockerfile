FROM eclipse-temurin:17-jdk-jammy

# Create non-root user (use UID 1001 to avoid conflicts)
RUN useradd -m -u 1001 -s /bin/bash runner

# Create working directory
RUN mkdir -p /box && chown runner:runner /box

# Install additional tools
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /box

# Switch to non-root user
USER runner

# Keep container alive (will be overridden at runtime)
CMD ["sleep", "infinity"]
