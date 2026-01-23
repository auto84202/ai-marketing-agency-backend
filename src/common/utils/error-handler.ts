/**
 * Utility function to safely extract error messages
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Utility function to safely log errors
 */
export function logError(logger: any, context: string, error: unknown): void {
  const message = getErrorMessage(error);
  logger.error(`${context}: ${message}`);
}

