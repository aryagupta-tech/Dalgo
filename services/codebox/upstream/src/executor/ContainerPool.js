import Docker from 'dockerode';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Container pool for reusing pre-warmed containers
 * This is an optional optimization to reduce container startup time
 */
class ContainerPool {
  constructor(options = {}) {
    this.docker = new Docker({ socketPath: config.docker.socketPath });
    this.pools = new Map(); // Map of image -> container[]
    this.maxPoolSize = options.maxPoolSize || 5;
    this.minPoolSize = options.minPoolSize || 2;
    this.warming = new Set(); // Images currently being warmed
  }

  /**
   * Initialize pool with pre-warmed containers for each language
   */
  async initialize(images) {
    logger.info({ event: 'pool_initializing', images });

    for (const image of images) {
      await this.warmPool(image);
    }

    logger.info({ event: 'pool_initialized' });
  }

  /**
   * Warm up containers for an image
   */
  async warmPool(image) {
    if (this.warming.has(image)) return;
    this.warming.add(image);

    const pool = this.pools.get(image) || [];
    const needed = this.minPoolSize - pool.length;

    if (needed > 0) {
      logger.debug({ event: 'pool_warming', image, needed });

      const containers = await Promise.all(
        Array(needed).fill(null).map(() => this.createPooledContainer(image))
      );

      pool.push(...containers.filter(Boolean));
      this.pools.set(image, pool);
    }

    this.warming.delete(image);
  }

  /**
   * Create a container for the pool
   */
  async createPooledContainer(image) {
    try {
      const container = await this.docker.createContainer({
        Image: image,
        Cmd: ['/bin/sh', '-c', 'sleep 3600'],
        WorkingDir: '/box',
        // User is set in Dockerfile for each language image
        NetworkDisabled: true,
        HostConfig: {
          Memory: config.execution.defaultMemoryLimit * 1024,
          MemorySwap: config.execution.defaultMemoryLimit * 1024,
          CpuPeriod: 100000,
          CpuQuota: 100000,
          PidsLimit: config.execution.maxProcesses,
          NetworkMode: 'none',
          SecurityOpt: ['no-new-privileges'],
          CapDrop: ['ALL'],
          Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
        },
        Tty: false,
        OpenStdin: true,
      });

      await container.start();

      return container;
    } catch (error) {
      logger.error({ event: 'pool_create_failed', image, error: error.message });
      return null;
    }
  }

  /**
   * Get a container from the pool or create a new one
   */
  async acquire(image) {
    const pool = this.pools.get(image) || [];

    if (pool.length > 0) {
      const container = pool.pop();
      this.pools.set(image, pool);

      // Trigger background warming
      this.warmPool(image).catch(() => {});

      return container;
    }

    // No containers available, create one on demand
    return await this.createPooledContainer(image);
  }

  /**
   * Return a container to the pool or destroy it
   */
  async release(image, container, reusable = false) {
    if (!reusable) {
      // Container is not reusable (e.g., files were written)
      await this.destroy(container);
      return;
    }

    const pool = this.pools.get(image) || [];

    if (pool.length < this.maxPoolSize) {
      // Reset container state
      try {
        await this.resetContainer(container);
        pool.push(container);
        this.pools.set(image, pool);
      } catch (error) {
        await this.destroy(container);
      }
    } else {
      await this.destroy(container);
    }
  }

  /**
   * Reset container state for reuse
   */
  async resetContainer(container) {
    // Remove files from /box
    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', 'rm -rf /box/* /tmp/*'],
      AttachStdout: false,
      AttachStderr: false,
    });

    await exec.start({ hijack: false });
  }

  /**
   * Destroy a container
   */
  async destroy(container) {
    try {
      await container.stop({ t: 0 }).catch(() => {});
      await container.remove({ force: true });
    } catch (error) {
      logger.warn({ event: 'pool_destroy_failed', error: error.message });
    }
  }

  /**
   * Shutdown all pools
   */
  async shutdown() {
    logger.info({ event: 'pool_shutting_down' });

    for (const [image, pool] of this.pools) {
      await Promise.all(pool.map(c => this.destroy(c)));
    }

    this.pools.clear();
    logger.info({ event: 'pool_shutdown_complete' });
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const stats = {};
    for (const [image, pool] of this.pools) {
      stats[image] = pool.length;
    }
    return stats;
  }
}

export default ContainerPool;
