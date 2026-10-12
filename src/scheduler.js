const { config } = require('./config');
const etsy = require('./channels/etsy');
const shopify = require('./channels/shopify');
const amazon = require('./channels/amazon');
const sashe = require('./channels/sashe');
const { upsertOrder } = require('./services/orders');
const { logEvent } = require('./services/events');
const {
  getChannelState,
  effectiveChannelEnabled,
  markPollStarted,
  markPollSuccess,
  markPollError,
  effectiveSince
} = require('./services/channelState');
const { performBackup } = require('./services/backup');

const adapters = { etsy, shopify, amazon, sashe };
let timer = null;
let startupTimer = null;
let stopped = false;
const backgroundJobs = new Set();
let backupTimer = null;
let polling = false;
const channelPolls = new Map();

function pollChannel(channel, options = {}) {
  if (stopped) return Promise.reject(new Error('Application is shutting down'));
  if (require('./maintenance').isActive()) return Promise.reject(new Error('Restore in progress'));
  // Share the active run, including forced/manual requests. Force only bypasses
  // the channel's enabled setting, never the synchronization lock.
  if (channelPolls.has(channel)) return channelPolls.get(channel);
  const run = runChannelPoll(channel, options).finally(() => {
    if (channelPolls.get(channel) === run) channelPolls.delete(channel);
  });
  channelPolls.set(channel, run);
  return run;
}

async function runChannelPoll(channel, options = {}) {
  if (require('./maintenance').isActive()) throw new Error('Restore in progress');
  const adapter = adapters[channel];
  if (!adapter) throw new Error(`Unknown channel ${channel}`);

  const state = await getChannelState(channel);
  const enabled = options.force || effectiveChannelEnabled(channel, state);
  if (!enabled) {
    return { channel, skipped: true, reason: 'disabled', imported: 0 };
  }

  const since = effectiveSince(state);
  if (await markPollStarted(channel) === false) {
    const error = new Error('SAShE connection cooldown. Please wait; automatic synchronization will retry later.');
    error.statusCode = 429;
    throw error;
  }

  try {
    const result = await adapter.poll({ since });
    const orders = result.orders || [];
    for (const order of orders) {
      await upsertOrder(order);
    }
    await markPollSuccess(channel, result.nextCursor || since);
    await logEvent('info', channel, `Poll succeeded: ${orders.length} order(s).`, {
      since,
      nextCursor: result.nextCursor || since
    });
    if (orders.length && config.webPushEnabled) {
      try { await require('./services/webPush').notify(); }
      catch (_) { console.error('[push] Notification unavailable; successful synchronization is preserved.'); }
    }
    return { channel, imported: orders.length, cursor: result.nextCursor || since };
  } catch (error) {
    await markPollError(channel, error);
    await logEvent('error', channel, error.message || String(error), { since });
    throw error;
  }
}

async function pollAll(options = {}) {
  if (stopped) return { skipped: true, reason: 'application is shutting down' };
  if (polling) {
    return { skipped: true, reason: 'poll already running' };
  }

  polling = true;
  const results = [];
  try {
    for (const channel of Object.keys(adapters)) {
      try {
        results.push(await pollChannel(channel, options));
      } catch (error) {
        results.push({ channel, error: error.message || String(error) });
      }
    }
    return { results };
  } finally {
    polling = false;
  }
}

function background(task, label) {
  if (stopped) return;
  const job = Promise.resolve().then(task).catch(() => { console.error(label); }).finally(() => backgroundJobs.delete(job));
  backgroundJobs.add(job);
  return job;
}

function startScheduler() {
  stopped = false;
  if (startupTimer) clearTimeout(startupTimer);

  const intervalMs = Math.max(config.pollIntervalMinutes, 1) * 60 * 1000;
  if (timer) clearInterval(timer);

  timer = setInterval(() => {
    pollAll().catch((error) => {
      console.error('Scheduled poll failed', error);
    });
  }, intervalMs);

  if (config.pollOnStart) {
    startupTimer = setTimeout(() => {
      startupTimer = null;
      pollAll().catch((error) => {
        console.error('Startup poll failed', error);
      });
    }, 5000);
  }

  if (backupTimer) clearTimeout(backupTimer);
  const msUntilMidnight = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return next.getTime() - now.getTime();
  };
  const scheduleMidnightBackup = () => {
    backupTimer = setTimeout(() => {
      backupTimer = null;
      background(performBackup, 'Scheduled backup failed');
      if (!stopped) scheduleMidnightBackup();
    }, msUntilMidnight());
  };
  scheduleMidnightBackup();
}

async function stopScheduler() {
  stopped = true;
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = null;
  while (polling || channelPolls.size || backgroundJobs.size) {
    await Promise.allSettled([...channelPolls.values(), ...backgroundJobs]);
    if (polling) await new Promise(resolve => setImmediate(resolve));
  }
}

module.exports = { pollAll, pollChannel, startScheduler, stopScheduler, isBusy: () => polling || channelPolls.size > 0 };
