import { AppErrorException, type AppErrorCode } from '../../src/errors.js';

/** Runs `fn` and returns the AppError code it threw, or fails if it did not throw one. */
export function codeOf(fn: () => unknown): AppErrorCode {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppErrorException) return err.appError.code;
    throw err;
  }
  throw new Error('expected an AppErrorException, but nothing was thrown');
}

export async function codeOfAsync(
  fn: () => Promise<unknown>
): Promise<AppErrorCode> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppErrorException) return err.appError.code;
    throw err;
  }
  throw new Error('expected an AppErrorException, but nothing was thrown');
}
