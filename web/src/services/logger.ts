import { logging } from './logging';

/**
 * MindMesh logging facade.
 *
 * Existing call sites use `logger.debug('Storage', 'message', {...})`. Everything
 * now flows into the centralized structured logger so diagnostics, the log viewer
 * and crash capture all share one retained history — no second logging system.
 *
 * Sensitive values (tokens, credentials, photo data, backup contents) are redacted
 * by the logging service before they are stored.
 */
export const logger = {
  debug(topic: string, message: string, metadata?: Record<string, unknown>): void {
    logging.debug(topic, message, metadata);
  },

  info(topic: string, message: string, metadata?: Record<string, unknown>): void {
    logging.info(topic, message, metadata);
  },

  warn(topic: string, message: string, metadata?: Record<string, unknown>): void {
    logging.warn(topic, message, metadata);
  },

  error(topic: string, message: string, err?: unknown): void {
    logging.error(topic, message, err);
  },

  critical(topic: string, message: string, err?: unknown): void {
    logging.critical(topic, message, err);
  },
};

export { logging };
