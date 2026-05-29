export class BtmError extends Error {
  constructor(message, { exitCode = 1 } = {}) {
    super(message);
    this.name = 'BtmError';
    this.exitCode = exitCode;
  }
}

export function formatCliError(error) {
  if (error instanceof BtmError) {
    return error.message;
  }

  if (error?.message) {
    return `Unexpected error: ${error.message}`;
  }

  return 'Unexpected error: unknown failure.';
}
