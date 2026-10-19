// WHATWG High Resolution Time: the performance object.
//
// The clock itself lives in the Java "performance" binding: a System.nanoTime
// monotonic clock, coarsened to the 100 microsecond resolution the spec
// requires, plus the epoch-relative time origin. This module provides the
// Performance interface surface around it, including the minimal Event /
// EventTarget behavior the interface requires.

var clock = getBinding("performance");

// A minimal Event (see the DOM standard for the full interface).
function Event(type, eventInitDict) {
  if (arguments.length < 1) {
    throw new TypeError(
        "Failed to construct 'Event': 1 argument required, but only 0 present.");
  }
  this.type = String(type);
  this.bubbles = !!(eventInitDict && eventInitDict.bubbles);
  this.cancelable = !!(eventInitDict && eventInitDict.cancelable);
  this.composed = !!(eventInitDict && eventInitDict.composed);
  this.defaultPrevented = false;
  this._immediatePropagationStopped = false;
}

Event.prototype.preventDefault = function () {
  if (this.cancelable) {
    this.defaultPrevented = true;
  }
};

Event.prototype.stopPropagation = function () {};

Event.prototype.stopImmediatePropagation = function () {
  this._immediatePropagationStopped = true;
};

// EventTarget state for the performance object. It is a single event target,
// so there is no propagation path: a dispatched event is delivered to this
// target's listeners only.
var __listeners = {};

function addEventListener(type, listener, options) {
  if (listener === null) {
    return;
  }
  var listeners = __listeners[type];
  if (!listeners) {
    listeners = __listeners[type] = [];
  }
  listeners.push({
    listener: listener,
    once: !!(options && options.once),
  });
}

function removeEventListener(type, listener) {
  var listeners = __listeners[type];
  if (!listeners) {
    return;
  }
  for (var i = 0; i < listeners.length; i++) {
    if (listeners[i].listener === listener) {
      listeners.splice(i, 1);
      return;
    }
  }
}

function dispatchEvent(event) {
  var listeners = __listeners[event.type];
  if (!listeners || listeners.length === 0) {
    return !event.defaultPrevented;
  }
  // The dispatch algorithm operates on a copy: listeners may add or remove
  // listeners during dispatch.
  var copy = listeners.slice();
  for (var i = 0; i < copy.length; i++) {
    if (event._immediatePropagationStopped) {
      break;
    }
    var entry = copy[i];
    var index = listeners.indexOf(entry);
    if (index === -1) {
      continue; // removed before its turn
    }
    if (entry.once) {
      listeners.splice(index, 1);
    }
    entry.listener.call(performance, event);
  }
  return !event.defaultPrevented;
}

var performance = {
  now: function () {
    return clock.now();
  },
  addEventListener: addEventListener,
  removeEventListener: removeEventListener,
  dispatchEvent: dispatchEvent,
};

Object.defineProperty(performance, "timeOrigin", {
  get: function () {
    return clock.timeOrigin;
  },
});

exports.performance = performance;
exports.Event = Event;
