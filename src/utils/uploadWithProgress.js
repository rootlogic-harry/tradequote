/**
 * Upload a file via XMLHttpRequest with real progress tracking.
 *
 * @param {object} opts
 * @param {string} opts.url        — POST endpoint
 * @param {FormData} opts.body     — form data to upload
 * @param {(progress: { percent: number, loaded: number, total: number, speed: number, eta: number }) => void} opts.onProgress
 * @returns {{ promise: Promise<any>, abort: () => void }}
 */
export function uploadWithProgress({ url, body, onProgress }) {
  const xhr = new XMLHttpRequest();
  const startTime = Date.now();

  const promise = new Promise((resolve, reject) => {
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      const speed = elapsed > 0 ? e.loaded / elapsed : 0; // bytes/sec
      const remaining = e.total - e.loaded;
      const eta = speed > 0 ? Math.round(remaining / speed) : 0; // seconds

      onProgress({ percent, loaded: e.loaded, total: e.total, speed, eta });
    };

    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error(data.error || `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        err.retryable = xhr.status >= 500;
        reject(err);
      }
    };

    xhr.onerror = () => {
      const err = new Error('Network error — check your connection and try again');
      err.retryable = true;
      reject(err);
    };

    xhr.ontimeout = () => {
      const err = new Error('Upload timed out — try a shorter video or better connection');
      err.retryable = true;
      reject(err);
    };

    xhr.onabort = () => {
      const err = new Error('Upload cancelled');
      err.name = 'AbortError';
      err.retryable = false;
      reject(err);
    };

    xhr.open('POST', url);
    xhr.timeout = 300000; // 5 minutes
    xhr.send(body);
  });

  return {
    promise,
    abort: () => xhr.abort(),
  };
}

/**
 * Upload with automatic retry on retryable errors.
 *
 * @param {object} opts — same as uploadWithProgress plus:
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.backoffMs=2000] — base delay (doubled each retry)
 * @param {(info: { attempt: number, maxRetries: number, error: Error }) => void} [opts.onRetry]
 * @returns {Promise<any>}
 */
export async function uploadWithRetry({
  url, body, onProgress, onRetry, abortRef,
  maxRetries = 3, backoffMs = 2000,
}) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { promise, abort } = uploadWithProgress({ url, body, onProgress });
      // Expose abort so callers can cancel the current XHR
      if (abortRef) abortRef.current = { abort };
      return await promise;
    } catch (err) {
      lastError = err;

      // Don't retry non-retryable errors (4xx, user abort)
      if (!err.retryable || attempt >= maxRetries) {
        throw err;
      }

      // Notify caller of retry
      onRetry?.({ attempt: attempt + 1, maxRetries, error: err });

      // Exponential backoff
      const delay = backoffMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
