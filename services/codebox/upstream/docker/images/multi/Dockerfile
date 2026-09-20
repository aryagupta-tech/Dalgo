FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install compilers, runtimes, and tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    openjdk-17-jdk-headless \
    python3 \
    ca-certificates \
    curl \
    gnupg \
    unzip \
    bash \
    time \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js via NodeSource signed repository
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (use UID 1001 to avoid conflicts)
RUN useradd -m -u 1001 -s /bin/bash runner

# Create working directory
RUN mkdir -p /box && chown runner:runner /box

# Set working directory
WORKDIR /box

# Switch to non-root user
USER runner

# Keep container alive (will be overridden at runtime)
CMD ["sleep", "infinity"]
