'use strict';
// Defense in depth for offline checks. Tests may replace fetch with fixtures.
require('dotenv').config = () => ({ parsed: {} });
const denied = () => { throw new Error('Offline check attempted network access. Use a mock or the isolated database suite.'); };
require('node:net').Socket.prototype.connect = denied;
require('node:dgram').Socket.prototype.send = denied;
global.fetch = denied;
