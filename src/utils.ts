import { MCPMetadata } from './types';

/**
 * Merge multiple metadata objects into one.
 * Performs a one-level deep merge: top-level object values are spread-merged
 * rather than overwritten, so { input: { a: 1 } } + { input: { b: 2 } }
 * produces { input: { a: 1, b: 2 } }.
 */
export function mergeMetadata(...metadatas: (MCPMetadata | undefined)[]): MCPMetadata {
  return metadatas.reduce<MCPMetadata>((acc, metadata) => {
    if (!metadata) return acc;
    const result = { ...acc };
    for (const key of Object.keys(metadata)) {
      const accVal = acc[key];
      const newVal = metadata[key];
      if (
        accVal && newVal &&
        typeof accVal === 'object' && !Array.isArray(accVal) &&
        typeof newVal === 'object' && !Array.isArray(newVal)
      ) {
        result[key] = { ...(accVal as Record<string, unknown>), ...(newVal as Record<string, unknown>) };
      } else {
        result[key] = newVal;
      }
    }
    return result;
  }, {});
}

/**
 * Log debug messages if debug mode is enabled
 */
export function debugLog(debug: boolean, message: string, ...args: any[]): void {
  if (debug) {
    console.log(`[MCPTracker] ${message}`, ...args);
  }
}

/**
 * Check if an error should be retried
 */
export function isRetryableError(error: any): boolean {
  // Network errors
  if (error.name === 'TypeError' || error.message?.includes('fetch')) {
    return true;
  }

  // HTTP errors
  if (error.status) {
    const status = error.status;
    // Don't retry client errors (except 408, 429 which we also don't retry but handle separately)
    if (status >= 400 && status < 500) {
      return false;
    }
    // Retry server errors
    if (status >= 500) {
      return true;
    }
  }

  // Default: retry
  return true;
}
