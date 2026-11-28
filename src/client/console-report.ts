/* oxlint-disable no-console -- dsh gives client plugins no logger, so the browser console is the plugin's only diagnostic sink. */
// Every console write the client makes goes through here, so the one place that talks to the
// console is the one place that says why it may.

/** Logs a failure that stopped a feature. Shaped to be passed straight as a promise's rejection
 *  handler: the rejection reason arrives as `cause` with no message, and is logged as-is. */
export const reportError = (cause?: unknown, message?: string): void => {
  if (message === undefined) {
    console.error(cause);
  } else {
    console.error(message, cause);
  }
};

/** Logs something that went wrong without stopping the page: a feature left out, a link that did
 *  not open. `cause`, when given, is logged after the message so the browser can expand it. */
export const reportWarning = (message: string, cause?: unknown): void => {
  if (cause === undefined) {
    console.warn(message);
  } else {
    console.warn(message, cause);
  }
};

/** Logs a trace line for a debug switch the owner turned on; `detail` is the state worth seeing
 *  beside it. Browsers hide these unless the console's verbose level is showing. */
export const reportDebug = (
  tag: string,
  message: string,
  detail?: Readonly<Record<string, string | undefined>>,
): void => {
  if (detail === undefined) {
    console.debug(tag, message);
  } else {
    console.debug(tag, message, detail);
  }
};
