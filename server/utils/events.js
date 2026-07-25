'use strict';

const { EventEmitter } = require('events');

/**
 * Tiny in-process event bus. When a new order is placed the orders route
 * emits 'order' and every connected kitchen/admin screen (subscribed via
 * Server-Sent Events) receives it instantly — no page refresh, no websockets,
 * no third-party service.
 */
const bus = new EventEmitter();
bus.setMaxListeners(100);

module.exports = bus;
