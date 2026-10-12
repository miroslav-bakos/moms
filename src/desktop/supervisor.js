'use strict';
const { EventEmitter } = require('node:events');

// The supervisor owns only its child. Stop uses IPC so Windows drains work too.
class Supervisor extends EventEmitter {
  constructor({ spawn, stopTimeout = 65000, retryDelay = 2000, failureWindow = 60000, maxFailures = 5 }) {
    super();
    Object.assign(this, { spawn, stopTimeout, retryDelay, failureWindow, maxFailures });
    this.phase = 'starting'; this.failures = []; this.stopping = false;
  }
  snapshot() { return { status: this.phase, childPid: this.child?.pid || null, ...(this.port?{url:`${this.secure?'https':'http'}://localhost:${this.port}`}:{}) }; }
  launch() {
    if (this.stopping || this.child) return;
    clearTimeout(this.retry);
    this.phase = 'starting';
    let child;
    try { child = this.spawn(); } catch (_) { this.failed(); return; }
    this.child = child;
    child.on('message', message => {
      if (this.child === child && !this.stopping && !this.restartPending && message?.type === 'moms-ready') {
        if(Number.isInteger(message.port)&&message.port>0&&message.port<=65535)this.port=message.port;
        this.secure=message.secure===true;
        this.phase = 'running'; this.emit('state');
      }
    });
    child.on('error', () => {}); // Spawn errors also deliver exit/close; never print inherited secrets.
    child.once('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.lastExit = { code, signal };
      clearTimeout(this.forceStop);
      if (this.stopping) { this.phase = 'stopped'; this.emit('stopped'); }
      else if (this.restartPending) { this.restartPending = false; this.launch(); }
      else this.failed(); // Exit 0 after restore must also restart the application.
      this.emit('state');
    });
    this.emit('state');
  }
  failed() {
    const now = Date.now();
    this.failures = this.failures.filter(time => now - time < this.failureWindow);
    this.failures.push(now);
    if (this.failures.length >= this.maxFailures) {
      this.phase = 'failed'; this.emit('failed'); this.emit('state'); return;
    }
    this.phase = 'retrying'; this.emit('state');
    this.retry = setTimeout(() => this.launch(), this.retryDelay);
  }
  drain() {
    if (!this.child) return;
    const child = this.child;
    if (child.connected) child.send({ type: 'moms-shutdown' }, () => {});
    // This is the owned child, never a PID from a stale file. Its own drain has a 60s limit.
    this.forceStop = setTimeout(() => child.kill('SIGKILL'), this.stopTimeout);
  }
  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true; this.restartPending = false; clearTimeout(this.retry);
    this.phase = 'stopping'; this.emit('state');
    this.stopPromise = new Promise(resolve => {
      const outcome = () => resolve({ clean: !this.lastExit || this.lastExit.code === 0 });
      if (!this.child) { this.phase = 'stopped'; outcome(); }
      else { this.once('stopped', outcome); this.drain(); }
    });
    return this.stopPromise;
  }
  restart() {
    if (this.stopping) throw new Error('MOMS is stopping.');
    if (this.restartPending) return;
    this.failures = []; clearTimeout(this.retry);
    this.restartPending = true; this.phase = 'restarting'; this.emit('state');
    if (this.child) this.drain();
    else { this.restartPending = false; this.launch(); }
  }
  ready(timeout = 120000) {
    return new Promise((resolve, reject) => {
      let timer;
      const done = error => {
        clearTimeout(timer); this.removeListener('state', check);
        error ? reject(error) : resolve(this.snapshot());
      };
      const check = () => {
        if (this.phase === 'running') done();
        else if (['failed', 'stopped', 'stopping'].includes(this.phase)) done(new Error('MOMS did not start. Check the private desktop log.'));
      };
      this.on('state', check);
      timer = setTimeout(() => done(new Error('MOMS startup timed out. Check status and the private desktop log.')), timeout);
      check();
    });
  }
}
module.exports = { Supervisor };
