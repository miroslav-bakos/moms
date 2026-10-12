'use strict';

// One shutdown owns the drain; repeated signals must not close the pool twice.
function createShutdown({ getServer, stopJobs, closeDatabase, ready = () => Promise.resolve(), exit = code => process.exit(code), timeoutMs = 60000 }) {
  let stopping = false, pending;
  return {
    isStopping: () => stopping,
    shutdown() {
      if (pending) return pending;
      stopping = true;
      pending = (async () => {
        const timeout = setTimeout(() => {
          console.error('Shutdown timed out; unfinished synchronization will retry after restart.');
          exit(1);
        }, timeoutMs);
        timeout.unref();
        try {
          const jobs = Promise.resolve(stopJobs());
          jobs.catch(() => {});
          await ready();
          const server = getServer();
          const requests = server ? new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeIdleConnections?.();
          }) : Promise.resolve();
          await Promise.all([jobs, requests]);
          await closeDatabase();
          exit(0);
        } catch (_) {
          console.error('Unable to complete application shutdown.');
          exit(1);
        } finally { clearTimeout(timeout); }
      })();
      return pending;
    }
  };
}

module.exports = { createShutdown };
