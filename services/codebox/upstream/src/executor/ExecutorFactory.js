import fs from 'fs';
import { execFileSync } from 'child_process';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import DockerExecutor from './DockerExecutor.js';
import FirecrackerExecutor from './FirecrackerExecutor.js';
import IsolateExecutor from './IsolateExecutor.js';

let executorInstance = null;
let executorType = null;

/**
 * Detect if isolate is available on the system
 */
function isIsolateAvailable() {
  try {
    execFileSync('isolate', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return { available: true, reason: null };
  } catch {
    return { available: false, reason: 'isolate binary not found or not working' };
  }
}

/**
 * Detect if Firecracker is available on the system
 */
function isFirecrackerAvailable() {
  if (process.platform !== 'linux') {
    return { available: false, reason: `Not Linux (${process.platform})` };
  }

  if (!fs.existsSync('/dev/kvm')) {
    return { available: false, reason: '/dev/kvm not found' };
  }

  const fcPaths = ['/usr/local/bin/firecracker', '/usr/bin/firecracker'];
  const fcExists = fcPaths.some(p => fs.existsSync(p));
  if (!fcExists) {
    return { available: false, reason: 'Firecracker binary not found' };
  }

  if (!fs.existsSync('/var/lib/codebox/firecracker/kernels/vmlinux')) {
    return { available: false, reason: 'Firecracker kernel not found' };
  }

  const rootfsDir = '/var/lib/codebox/firecracker/rootfs';
  if (!fs.existsSync(rootfsDir)) {
    return { available: false, reason: 'Firecracker rootfs directory not found' };
  }

  const rootfsFiles = fs.readdirSync(rootfsDir).filter(f => f.endsWith('.ext4'));
  if (rootfsFiles.length === 0) {
    return { available: false, reason: 'No Firecracker rootfs images found' };
  }

  return { available: true, reason: null };
}

/**
 * Get the appropriate executor based on configuration and system capabilities.
 * Priority: isolate > firecracker > docker
 */
export function getExecutor() {
  if (executorInstance) {
    return executorInstance;
  }

  const configuredType = config.executor?.type || 'auto';

  if (configuredType === 'isolate') {
    const iso = isIsolateAvailable();
    if (!iso.available) {
      throw new Error(`Isolate requested but not available: ${iso.reason}`);
    }
    executorType = 'isolate';
    executorInstance = new IsolateExecutor();
  } else if (configuredType === 'firecracker') {
    const fc = isFirecrackerAvailable();
    if (!fc.available) {
      throw new Error(`Firecracker requested but not available: ${fc.reason}`);
    }
    executorType = 'firecracker';
    executorInstance = new FirecrackerExecutor();
  } else if (configuredType === 'docker') {
    executorType = 'docker';
    executorInstance = new DockerExecutor();
  } else {
    // Auto-detect: prefer isolate > firecracker > docker
    const iso = isIsolateAvailable();
    if (iso.available) {
      executorType = 'isolate';
      executorInstance = new IsolateExecutor();
      logger.info('Auto-selected Isolate executor (strongest isolation, precise measurements)');
    } else {
      const fc = isFirecrackerAvailable();
      if (fc.available) {
        executorType = 'firecracker';
        executorInstance = new FirecrackerExecutor();
        logger.info('Auto-selected Firecracker executor');
      } else {
        executorType = 'docker';
        executorInstance = new DockerExecutor();
        logger.info({ isoReason: iso.reason }, 'Auto-selected Docker executor (fallback)');
      }
    }
  }

  logger.info({ executorType }, 'Executor initialized');
  return executorInstance;
}

/**
 * Get the current executor type
 */
export function getExecutorType() {
  if (!executorType) {
    getExecutor();
  }
  return executorType;
}

/**
 * Check system capabilities and return info
 */
export function getSystemCapabilities() {
  const docker = {
    available: fs.existsSync(config.docker.socketPath),
    socketPath: config.docker.socketPath,
  };

  const firecracker = isFirecrackerAvailable();
  const isolate = isIsolateAvailable();

  return {
    platform: process.platform,
    arch: process.arch,
    isolate: {
      available: isolate.available,
      reason: isolate.reason,
    },
    docker,
    firecracker: {
      available: firecracker.available,
      reason: firecracker.reason,
    },
    recommended: isolate.available ? 'isolate' : (firecracker.available ? 'firecracker' : 'docker'),
    current: executorType || 'not initialized',
  };
}

export default {
  getExecutor,
  getExecutorType,
  getSystemCapabilities,
};
