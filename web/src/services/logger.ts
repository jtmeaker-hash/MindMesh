/**
 * Safe logging utility for MindMesh.
 * Suppresses verbose debug logs in production and avoids logging personal/sensitive content.
 */

const isDev = import.meta.env.DEV;

export const logger = {
  debug(topic: string, message: string, metadata?: Record<string, unknown>) {
    if (isDev) {
      console.log(`[MindMesh:${topic}] ${message}`, metadata ? metadata : '');
    }
  },

  info(topic: string, message: string, metadata?: Record<string, unknown>) {
    if (isDev) {
      console.info(`[MindMesh:${topic}] ${message}`, metadata ? metadata : '');
    }
  },

  warn(topic: string, message: string, metadata?: Record<string, unknown>) {
    console.warn(`[MindMesh:${topic}] ${message}`, metadata ? metadata : '');
  },

  error(topic: string, message: string, err?: unknown) {
    console.error(`[MindMesh:${topic}] ${message}`, err ? err : '');
  },
};
