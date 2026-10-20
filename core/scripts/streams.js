// WHATWG Streams: readable streams and queuing strategies.
//
// Implements the ReadableStream class (with its default controller and
// default reader), the ReadableStreamDefaultReader class, the
// ReadableStream.from() static, ReadableStream.tee(), and asynchronous
// iteration over readable streams, plus the CountQueuingStrategy and
// ByteLengthQueuingStrategy built-in queuing strategies, as specified in
// the WHATWG Streams standard (specs/streams.bs).
//
// Readable byte streams (type: "bytes"), writable streams, transform
// streams, and piping are not implemented yet.

// Well-known symbols that the pinned Rhino build does not define. Babel's
// async-to-promises helpers use the same fallback, so defining these here
// (the module loads before any test script runs) keeps both sides in
// agreement.
if (Symbol.asyncIterator === undefined) {
  Symbol.asyncIterator = Symbol("Symbol.asyncIterator");
}
const kAsyncIterator = Symbol.asyncIterator;

// Internal slot keys.
const kState = Symbol("state");
const kStoredError = Symbol("storedError");
const kReader = Symbol("reader");
const kController = Symbol("controller");
const kDisturbed = Symbol("disturbed");

const kStream = Symbol("stream");
const kQueue = Symbol("queue");
const kQueueTotalSize = Symbol("queueTotalSize");
const kStarted = Symbol("started");
const kCloseRequested = Symbol("closeRequested");
const kPullAgain = Symbol("pullAgain");
const kPulling = Symbol("pulling");
const kStrategySizeAlgorithm = Symbol("strategySizeAlgorithm");
const kStrategyHighWaterMark = Symbol("strategyHighWaterMark");
const kPullAlgorithm = Symbol("pullAlgorithm");
const kCancelAlgorithm = Symbol("cancelAlgorithm");

const kClosedPromise = Symbol("closedPromise");
const kReadRequests = Symbol("readRequests");

const kIteratorReader = Symbol("iteratorReader");
const kPreventCancel = Symbol("preventCancel");

const kIteratorDone = Symbol("iteratorDone");

const kHighWaterMark = Symbol("highWaterMark");

// Sentinel for the "end of iteration" completion.
const kEndOfIteration = Symbol("endOfIteration");

// Queue a microtask (the spec's "perform a microtask checkpoint").
function queueMicrotask(fn) {
  Promise.resolve().then(fn);
}

function typeError(message) {
  return new TypeError(message);
}

// ======================================================================
// Queuing strategies
// ======================================================================

// The size functions are global (one per strategy class, shared by all
// instances), are plain functions rather than methods (so they have no
// `this` behavior), and must not be constructable: arrow functions give
// all of that, and the `size` binding names them per the spec.
var countQueuingStrategySizeFn;
(function () {
  var size = () => 1;
  countQueuingStrategySizeFn = size;
})();

var byteLengthQueuingStrategySizeFn;
(function () {
  var size = chunk => {
    return chunk.byteLength;
  };
  byteLengthQueuingStrategySizeFn = size;
})();

// Validates and converts a QueuingStrategyInit dictionary argument.
function convertQueuingStrategyInit(className, init) {
  if (init === null || init === undefined) {
    throw typeError(
        "Failed to construct '" + className + "': 1 argument required, but only 0 present.");
  }
  if (typeof init !== "object" && typeof init !== "function") {
    throw typeError("Failed to construct '" + className +
        "': provided value is not of type 'object'.");
  }
  var highWaterMark = init.highWaterMark; // may throw via a getter
  if (highWaterMark === undefined) {
    throw typeError(
        "Failed to construct '" + className +
            "': member highWaterMark is required and not present.");
  }
  return Number(highWaterMark); // unrestricted double; may throw
}

function CountQueuingStrategy(init) {
  this[kHighWaterMark] = convertQueuingStrategyInit("CountQueuingStrategy", init);
}

Object.defineProperty(CountQueuingStrategy.prototype, "highWaterMark", {
  get: function () {
    return this[kHighWaterMark];
  },
  enumerable: false,
  configurable: true,
});

Object.defineProperty(CountQueuingStrategy.prototype, "size", {
  get: function () {
    return countQueuingStrategySizeFn;
  },
  enumerable: false,
  configurable: true,
});

function ByteLengthQueuingStrategy(init) {
  this[kHighWaterMark] = convertQueuingStrategyInit("ByteLengthQueuingStrategy", init);
}

Object.defineProperty(ByteLengthQueuingStrategy.prototype, "highWaterMark", {
  get: function () {
    return this[kHighWaterMark];
  },
  enumerable: false,
  configurable: true,
});

Object.defineProperty(ByteLengthQueuingStrategy.prototype, "size", {
  get: function () {
    return byteLengthQueuingStrategySizeFn;
  },
  enumerable: false,
  configurable: true,
});

// ======================================================================
// ReadableStream: core state and stream-level algorithms
// ======================================================================

// InitializeReadableStream(stream)
function initializeReadableStream(stream) {
  stream[kState] = "readable";
  stream[kReader] = undefined;
  stream[kStoredError] = undefined;
  stream[kDisturbed] = false;
}

// IsReadableStreamLocked(stream)
function isReadableStreamLocked(stream) {
  return stream[kReader] !== undefined;
}

// ReadableStreamGetNumReadRequests(stream)
function readableStreamGetNumReadRequests(stream) {
  return stream[kReader][kReadRequests].length;
}

// ReadableStreamAddReadRequest(stream, readRequest)
function readableStreamAddReadRequest(stream, readRequest) {
  stream[kReader][kReadRequests].push(readRequest);
}

// ReadableStreamFulfillReadRequest(stream, chunk, done)
function readableStreamFulfillReadRequest(stream, chunk, done) {
  const reader = stream[kReader];
  const readRequest = reader[kReadRequests].shift();
  if (done) {
    readRequest.close();
  } else {
    readRequest.chunk(chunk);
  }
}

// ReadableStreamClose(stream)
function readableStreamClose(stream) {
  stream[kState] = "closed";
  const reader = stream[kReader];
  if (reader === undefined) {
    return;
  }
  reader[kClosedPromise].resolve(undefined);
  const readRequests = reader[kReadRequests];
  reader[kReadRequests] = [];
  for (var i = 0; i < readRequests.length; i++) {
    readRequests[i].close();
  }
}

// ReadableStreamError(stream, e)
function readableStreamError(stream, e) {
  stream[kState] = "errored";
  stream[kStoredError] = e;
  const reader = stream[kReader];
  if (reader === undefined) {
    return;
  }
  reader[kClosedPromise].reject(e);
  reader[kClosedPromise].promise.then(
      undefined,
      function () {}
  ); // mark the rejection as handled
  const readRequests = reader[kReadRequests];
  reader[kReadRequests] = [];
  for (var i = 0; i < readRequests.length; i++) {
    readRequests[i].error(e);
  }
}

// ReadableStreamCancel(stream, reason)
function readableStreamCancel(stream, reason) {
  stream[kDisturbed] = true;
  if (stream[kState] === "closed") {
    return Promise.resolve(undefined);
  }
  if (stream[kState] === "errored") {
    return Promise.reject(stream[kStoredError]);
  }
  readableStreamClose(stream);
  const sourceCancelPromise = defaultControllerCancelSteps(stream[kController], reason);
  return sourceCancelPromise.then(
      function () {
        return undefined;
      },
      function (e) {
        throw e;
      }
  );
}

// ======================================================================
// ReadableStreamDefaultController
// ======================================================================

// DequeueValue(container), EnqueueValueWithSize(container, value, size),
// ResetQueue(container)
function resetQueue(container) {
  container[kQueue] = [];
  container[kQueueTotalSize] = 0;
}

function dequeueValue(container) {
  const valueWithSize = container[kQueue].shift();
  container[kQueueTotalSize] -= valueWithSize[1];
  if (container[kQueueTotalSize] < 0) {
    container[kQueueTotalSize] = 0; // rounding error
  }
  return valueWithSize[0];
}

function enqueueValueWithSize(container, value, size) {
  // IsNonNegativeNumber(size)
  if (size != size || size < 0) {
    throw new RangeError("Invalid chunk size: " + size);
  }
  if (size === Infinity) {
    throw new RangeError("Invalid chunk size: " + size);
  }
  container[kQueue].push([value, size]);
  container[kQueueTotalSize] += size;
}

// ReadableStreamDefaultControllerCanCloseOrEnqueue(controller)
function defaultControllerCanCloseOrEnqueue(controller) {
  const state = controller[kStream][kState];
  return !controller[kCloseRequested] && state === "readable";
}

// ReadableStreamDefaultControllerGetDesiredSize(controller)
function defaultControllerGetDesiredSize(controller) {
  const state = controller[kStream][kState];
  if (state === "errored") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return controller[kStrategyHighWaterMark] - controller[kQueueTotalSize];
}

// ReadableStreamDefaultControllerClearAlgorithms(controller)
function defaultControllerClearAlgorithms(controller) {
  controller[kPullAlgorithm] = undefined;
  controller[kCancelAlgorithm] = undefined;
  controller[kStrategySizeAlgorithm] = undefined;
}

// ReadableStreamDefaultControllerShouldCallPull(controller)
function defaultControllerShouldCallPull(controller) {
  const stream = controller[kStream];
  if (!defaultControllerCanCloseOrEnqueue(controller)) {
    return false;
  }
  if (!controller[kStarted]) {
    return false;
  }
  if (isReadableStreamLocked(stream) && readableStreamGetNumReadRequests(stream) > 0) {
    return true;
  }
  const desiredSize = defaultControllerGetDesiredSize(controller);
  return desiredSize > 0;
}

// ReadableStreamDefaultControllerCallPullIfNeeded(controller)
function defaultControllerCallPullIfNeeded(controller) {
  if (!defaultControllerShouldCallPull(controller)) {
    return;
  }
  if (controller[kPulling]) {
    controller[kPullAgain] = true;
    return;
  }
  controller[kPulling] = true;
  const pullPromise = controller[kPullAlgorithm]();
  pullPromise.then(
      function () {
        controller[kPulling] = false;
        if (controller[kPullAgain]) {
          controller[kPullAgain] = false;
          defaultControllerCallPullIfNeeded(controller);
        }
      },
      function (e) {
        defaultControllerError(controller, e);
      }
  );
}

// ReadableStreamDefaultControllerError(controller, e)
function defaultControllerError(controller, e) {
  const stream = controller[kStream];
  if (stream[kState] !== "readable") {
    return;
  }
  resetQueue(controller);
  defaultControllerClearAlgorithms(controller);
  readableStreamError(stream, e);
}

// ReadableStreamDefaultControllerClose(controller)
function defaultControllerClose(controller) {
  if (!defaultControllerCanCloseOrEnqueue(controller)) {
    return;
  }
  const stream = controller[kStream];
  controller[kCloseRequested] = true;
  if (controller[kQueue].length === 0) {
    defaultControllerClearAlgorithms(controller);
    readableStreamClose(stream);
  }
}

// ReadableStreamDefaultControllerEnqueue(controller, chunk). May throw a
// RangeError, which the public enqueue() method re-throws after erroring
// the stream.
function defaultControllerEnqueue(controller, chunk) {
  if (!defaultControllerCanCloseOrEnqueue(controller)) {
    return;
  }
  const stream = controller[kStream];
  if (isReadableStreamLocked(stream) && readableStreamGetNumReadRequests(stream) > 0) {
    readableStreamFulfillReadRequest(stream, chunk, false);
  } else {
    var chunkSize;
    try {
      chunkSize = controller[kStrategySizeAlgorithm](chunk);
    } catch (e) {
      defaultControllerError(controller, e);
      throw e;
    }
    try {
      enqueueValueWithSize(controller, chunk, chunkSize);
    } catch (e) {
      defaultControllerError(controller, e);
      throw e;
    }
  }
  defaultControllerCallPullIfNeeded(controller);
}

// [[PullSteps]](readRequest)
function defaultControllerPullSteps(controller, readRequest) {
  const stream = controller[kStream];
  if (controller[kQueue].length !== 0) {
    const chunk = dequeueValue(controller);
    if (controller[kCloseRequested] && controller[kQueue].length === 0) {
      defaultControllerClearAlgorithms(controller);
      readableStreamClose(stream);
    } else {
      defaultControllerCallPullIfNeeded(controller);
    }
    readRequest.chunk(chunk);
  } else {
    readableStreamAddReadRequest(stream, readRequest);
    defaultControllerCallPullIfNeeded(controller);
  }
}

// [[CancelSteps]](reason)
function defaultControllerCancelSteps(controller, reason) {
  resetQueue(controller);
  const result = controller[kCancelAlgorithm](reason);
  defaultControllerClearAlgorithms(controller);
  return result;
}

// [[ReleaseSteps]]()
function defaultControllerReleaseSteps() {}

// SetUpReadableStreamDefaultController(stream, controller, startAlgorithm,
// pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm)
function setUpReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm
) {
  controller[kStream] = stream;
  resetQueue(controller);
  controller[kStarted] = false;
  controller[kCloseRequested] = false;
  controller[kPullAgain] = false;
  controller[kPulling] = false;
  controller[kStrategySizeAlgorithm] = sizeAlgorithm;
  controller[kStrategyHighWaterMark] = highWaterMark;
  controller[kPullAlgorithm] = pullAlgorithm;
  controller[kCancelAlgorithm] = cancelAlgorithm;
  stream[kController] = controller;
  const startResult = startAlgorithm(); // may throw
  const startPromise = Promise.resolve(startResult);
  startPromise.then(
      function () {
        controller[kStarted] = true;
        defaultControllerCallPullIfNeeded(controller);
      },
      function (r) {
        defaultControllerError(controller, r);
      }
  );
}

// The public controller interface. The object is created internally by
// the stream implementation; the constructor exists for the Web IDL
// surface only.
function ReadableStreamDefaultController() {
  throw typeError("ReadableStreamDefaultController instances cannot be created directly.");
}

Object.defineProperty(ReadableStreamDefaultController.prototype, "desiredSize", {
  get: function () {
    return defaultControllerGetDesiredSize(this);
  },
  enumerable: false,
  configurable: true,
});

ReadableStreamDefaultController.prototype.close = function () {
  if (!defaultControllerCanCloseOrEnqueue(this)) {
    throw typeError(
        "ReadableStreamDefaultController.close can only be used when not closed or errored");
  }
  defaultControllerClose(this);
};

ReadableStreamDefaultController.prototype.enqueue = function (chunk) {
  if (!defaultControllerCanCloseOrEnqueue(this)) {
    throw typeError(
        "ReadableStreamDefaultController.enqueue can only be used when not closed or errored");
  }
  defaultControllerEnqueue(this, chunk);
};

ReadableStreamDefaultController.prototype.error = function (e) {
  defaultControllerError(this, e);
};

// ======================================================================
// ReadableStreamDefaultReader
// ======================================================================

// A reader's [[closedPromise]] is kept as a holder object so that the
// stream state algorithms can settle the promise, even though the
// promise itself cannot expose its settle functions.
function makeClosedPromiseHolder(promise) {
  return {
    promise: promise,
    resolve: function () {},
    reject: function () {},
  };
}

function makePendingClosedPromiseHolder() {
  const holder = {
    promise: undefined,
    resolve: undefined,
    reject: undefined,
  };
  holder.promise = new Promise(function (resolve, reject) {
    holder.resolve = resolve;
    holder.reject = reject;
  });
  return holder;
}

// ReadableStreamReaderGenericInitialize(reader, stream)
function readerGenericInitialize(reader, stream) {
  reader[kStream] = stream;
  stream[kReader] = reader;
  const state = stream[kState];
  if (state === "readable") {
    reader[kClosedPromise] = makePendingClosedPromiseHolder();
  } else if (state === "closed") {
    reader[kClosedPromise] = makeClosedPromiseHolder(Promise.resolve(undefined));
  } else {
    reader[kClosedPromise] = makeClosedPromiseHolder(Promise.reject(stream[kStoredError]));
    reader[kClosedPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
  }
}

// ReadableStreamReaderGenericRelease(reader)
function readerGenericRelease(reader) {
  const stream = reader[kStream];
  if (stream[kState] === "readable") {
    reader[kClosedPromise].reject(
        typeError("ReadableStreamDefaultReader.releaseLock can only be used when owned"));
  } else {
    reader[kClosedPromise] = makeClosedPromiseHolder(
        Promise.reject(
            typeError("ReadableStreamDefaultReader.releaseLock can only be used when owned")));
    reader[kClosedPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
  }
  defaultControllerReleaseSteps();
  stream[kReader] = undefined;
  reader[kStream] = undefined;
}

// ReadableStreamDefaultReaderErrorReadRequests(reader, e)
function defaultReaderErrorReadRequests(reader, e) {
  const readRequests = reader[kReadRequests];
  reader[kReadRequests] = [];
  for (var i = 0; i < readRequests.length; i++) {
    readRequests[i].error(e);
  }
}

// ReadableStreamDefaultReaderRead(reader, readRequest)
function defaultReaderRead(reader, readRequest) {
  const stream = reader[kStream];
  stream[kDisturbed] = true;
  const state = stream[kState];
  if (state === "closed") {
    readRequest.close();
  } else if (state === "errored") {
    readRequest.error(stream[kStoredError]);
  } else {
    defaultControllerPullSteps(stream[kController], readRequest);
  }
}

// ReadableStreamDefaultReaderRelease(reader)
function defaultReaderRelease(reader) {
  readerGenericRelease(reader);
  defaultReaderErrorReadRequests(
      reader, typeError("ReadableStreamDefaultReader was released"));
}

// Brand check: is this object a ReadableStream (or subclass) instance?
function isReadableStream(object) {
  return object !== null &&
      typeof object === "object" &&
      object[kState] !== undefined;
}

// SetUpReadableStreamDefaultReader(reader, stream)
function setUpReadableStreamDefaultReader(reader, stream) {
  if (!isReadableStream(stream)) {
    throw typeError(
        "Failed to construct 'ReadableStreamDefaultReader': argument is not a ReadableStream.");
  }
  if (isReadableStreamLocked(stream)) {
    throw typeError("Failed to construct 'ReadableStreamDefaultReader': " +
        "stream is already locked to a different reader object.");
  }
  readerGenericInitialize(reader, stream);
  reader[kReadRequests] = [];
}

// AcquireReadableStreamDefaultReader(stream)
function acquireReadableStreamDefaultReader(stream) {
  const reader = Object.create(ReadableStreamDefaultReader.prototype);
  setUpReadableStreamDefaultReader(reader, stream);
  return reader;
}

function ReadableStreamDefaultReader(stream) {
  const reader = Object.create(ReadableStreamDefaultReader.prototype);
  setUpReadableStreamDefaultReader(reader, stream);
  return reader;
}

Object.defineProperty(ReadableStreamDefaultReader.prototype, "closed", {
  get: function () {
    return this[kClosedPromise].promise;
  },
  enumerable: false,
  configurable: true,
});

ReadableStreamDefaultReader.prototype.cancel = function (reason) {
  if (this[kStream] === undefined) {
    return Promise.reject(
        typeError("ReadableStreamDefaultReader.cancel can only be used on active readers"));
  }
  return readableStreamCancel(this[kStream], reason);
};

ReadableStreamDefaultReader.prototype.read = function () {
  if (this[kStream] === undefined) {
    return Promise.reject(
        typeError("ReadableStreamDefaultReader.read can only be used on active readers"));
  }
  const reader = this;
  const promise = new Promise(function (resolve, reject) {
    const readRequest = {
      chunk: function (chunk) {
        resolve({
          value: chunk,
          done: false,
        });
      },
      close: function () {
        resolve({
          value: undefined,
          done: true,
        });
      },
      error: function (e) {
        reject(e);
      },
    };
    defaultReaderRead(reader, readRequest);
  });
  return promise;
};

ReadableStreamDefaultReader.prototype.releaseLock = function () {
  if (this[kStream] === undefined) {
    return;
  }
  defaultReaderRelease(this);
};

// ======================================================================
// ReadableStream
// ======================================================================

// CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm[,
// highWaterMark[, sizeAlgorithm]])
function createReadableStream(
    startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm
) {
  if (highWaterMark === undefined) {
    highWaterMark = 1;
  }
  if (sizeAlgorithm === undefined) {
    sizeAlgorithm = function () {
      return 1;
    };
  }
  const stream = Object.create(ReadableStream.prototype);
  initializeReadableStream(stream);
  const controller = Object.create(ReadableStreamDefaultController.prototype);
  setUpReadableStreamDefaultController(
      stream,
      controller,
      startAlgorithm,
      pullAlgorithm,
      cancelAlgorithm,
      highWaterMark,
      sizeAlgorithm
  );
  return stream;
}

// SetUpReadableStreamDefaultControllerFromUnderlyingSource(stream,
// underlyingSource, startFn, pullFn, cancelFn, highWaterMark, sizeAlgorithm)
//
// |startFn|, |pullFn|, and |cancelFn| are the underlying source's methods
// already converted by the constructor (each either a function or
// undefined); |underlyingSource| is the original object used as the
// callback this value.
function setUpReadableStreamDefaultControllerFromUnderlyingSource(
    stream,
    underlyingSource,
    startFn,
    pullFn,
    cancelFn,
    highWaterMark,
    sizeAlgorithm
) {
  const controller = Object.create(ReadableStreamDefaultController.prototype);

  var startAlgorithm = function () {
    return undefined;
  };
  var pullAlgorithm = function () {
    return Promise.resolve(undefined);
  };
  var cancelAlgorithm = function () {
    return Promise.resolve(undefined);
  };

  if (startFn !== undefined) {
    startAlgorithm = function () {
      return startFn.call(underlyingSource, controller); // may throw
    };
  }
  if (pullFn !== undefined) {
    pullAlgorithm = function () {
      try {
        return Promise.resolve(pullFn.call(underlyingSource, controller));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  if (cancelFn !== undefined) {
    cancelAlgorithm = function (reason) {
      try {
        return Promise.resolve(cancelFn.call(underlyingSource, reason));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }

  setUpReadableStreamDefaultController(
      stream,
      controller,
      startAlgorithm,
      pullAlgorithm,
      cancelAlgorithm,
      highWaterMark,
      sizeAlgorithm
  );
}

function ReadableStream(underlyingSource, strategy) {
  // IDL: underlyingSource is an optional object argument. null and
  // non-object values are not convertible; missing or undefined becomes
  // null.
  if (underlyingSource === null) {
    throw typeError("Failed to construct 'ReadableStream': " +
        "underlyingSource must not be null.");
  }
  if (underlyingSource !== undefined &&
      typeof underlyingSource !== "object" &&
      typeof underlyingSource !== "function") {
    throw typeError("Failed to construct 'ReadableStream': " +
        "underlyingSource must be an object.");
  }
  // IDL: strategy is an optional QueuingStrategy = {} dictionary
  // argument, converted at the IDL layer, i.e. before the underlying
  // source's properties are read in the method body.
  if (strategy === undefined || strategy === null) {
    strategy = {};
  }
  if (typeof strategy !== "object" && typeof strategy !== "function") {
    throw typeError("Failed to construct 'ReadableStream': strategy must be an object.");
  }
  var highWaterMarkValue = strategy.highWaterMark; // may throw via a getter
  if (highWaterMarkValue !== undefined) {
    highWaterMarkValue = Number(highWaterMarkValue); // unrestricted double
  }
  var sizeValue = strategy.size; // may throw via a getter
  if (sizeValue !== undefined && typeof sizeValue !== "function") {
    throw typeError(
        "Failed to convert argument 'size' of 'QueuingStrategy': provided value is not a function.");
  }

  if (underlyingSource === undefined) {
    underlyingSource = null;
  }

  // Convert the underlying source to an UnderlyingSource dictionary
  // (members read in declaration order).
  var sourceType;
  var startFn;
  var pullFn;
  var cancelFn;
  if (underlyingSource !== null) {
    sourceType = underlyingSource.type; // may throw
    if (sourceType !== undefined) {
      sourceType = String(sourceType); // may throw
    }
    startFn = underlyingSource.start; // may throw
    pullFn = underlyingSource.pull; // may throw
    cancelFn = underlyingSource.cancel; // may throw
  }
  if (startFn !== undefined && typeof startFn !== "function") {
    throw typeError("Failed to convert argument 'start' of 'UnderlyingSource': " +
        "provided value is not a function.");
  }
  if (pullFn !== undefined && typeof pullFn !== "function") {
    throw typeError("Failed to convert argument 'pull' of 'UnderlyingSource': " +
        "provided value is not a function.");
  }
  if (cancelFn !== undefined && typeof cancelFn !== "function") {
    throw typeError("Failed to convert argument 'cancel' of 'UnderlyingSource': " +
        "provided value is not a function.");
  }

  // InitializeReadableStream
  initializeReadableStream(this);

  // The underlying source's type member (if present) must be "bytes".
  if (sourceType !== undefined) {
    if (sourceType === "bytes") {
      throw new RangeError("Readable byte streams are not implemented yet");
    }
    throw typeError("Invalid readable stream type: '" + sourceType + "'");
  }

  // ExtractSizeAlgorithm(strategy)
  var sizeAlgorithm;
  if (sizeValue === undefined) {
    sizeAlgorithm = function () {
      return 1;
    };
  } else {
    sizeAlgorithm = function (chunk) {
      return sizeValue(chunk);
    };
  }
  // ExtractHighWaterMark(strategy, 1)
  var highWaterMark;
  if (highWaterMarkValue === undefined) {
    highWaterMark = 1;
  } else {
    if (highWaterMarkValue != highWaterMarkValue || highWaterMarkValue < 0) {
      throw new RangeError("Invalid high water mark: " + highWaterMarkValue);
    }
    highWaterMark = highWaterMarkValue;
  }

  setUpReadableStreamDefaultControllerFromUnderlyingSource(
      this, underlyingSource, startFn, pullFn, cancelFn, highWaterMark, sizeAlgorithm);
}

Object.defineProperty(ReadableStream.prototype, "locked", {
  get: function () {
    return isReadableStreamLocked(this);
  },
  enumerable: false,
  configurable: true,
});

ReadableStream.prototype.cancel = function (reason) {
  if (isReadableStreamLocked(this)) {
    return Promise.reject(
        typeError("ReadableStream.cancel can only be used on unlocked streams"));
  }
  return readableStreamCancel(this, reason);
};

ReadableStream.prototype.getReader = function (options) {
  if (options !== undefined && options !== null) {
    if (typeof options !== "object" && typeof options !== "function") {
      throw typeError("Failed to execute 'getReader' on 'ReadableStream': " +
          "options must be an object.");
    }
    var mode = options.mode; // may throw
    if (mode !== undefined) {
      mode = String(mode); // may throw
      if (mode === "byob") {
        throw typeError("BYOB readers are not implemented yet");
      }
      throw typeError("Invalid reader mode: '" + mode + "'");
    }
  }
  return acquireReadableStreamDefaultReader(this);
};

ReadableStream.prototype.tee = function () {
  return readableStreamDefaultTee(this, false);
};

ReadableStream.from = function (asyncIterable) {
  return readableStreamFromIterable(asyncIterable);
};

// ======================================================================
// Asynchronous iteration
// ======================================================================

const readableStreamIteratorPrototype = Object.create(Object.prototype);

readableStreamIteratorPrototype.next = function next() {
  const reader = this[kIteratorReader];
  if (reader === undefined || reader[kStream] === undefined) {
    return Promise.reject(typeError("The stream is no longer readable"));
  }
  const promise = new Promise(function (resolve, reject) {
    const readRequest = {
      chunk: function (chunk) {
        resolve(chunk);
      },
      close: function () {
        defaultReaderRelease(reader);
        resolve(kEndOfIteration);
      },
      error: function (e) {
        defaultReaderRelease(reader);
        reject(e);
      },
    };
    defaultReaderRead(reader, readRequest);
  });
  return promise.then(
      function (v) {
        if (v === kEndOfIteration) {
          return {
            value: undefined,
            done: true,
          };
        }
        return {
          value: v,
          done: false,
        };
      },
      function (e) {
        throw e;
      }
  );
};

readableStreamIteratorPrototype["return"] = function () {
  const reader = this[kIteratorReader];
  if (reader === undefined || reader[kStream] === undefined) {
    // The reader was already released (e.g. by a settled next()); the
    // release is idempotent, so this is a no-op.
    return Promise.resolve(undefined);
  }
  if (!this[kPreventCancel]) {
    const result = readableStreamCancel(reader[kStream], arguments[0]);
    defaultReaderRelease(reader);
    return result;
  }
  defaultReaderRelease(reader);
  return Promise.resolve(undefined);
};

Object.defineProperty(readableStreamIteratorPrototype, kAsyncIterator, {
  value: function () {
    return this;
  },
  enumerable: false,
  writable: true,
  configurable: true,
});

ReadableStream.prototype.values = function (options) {
  if (options !== undefined && options !== null) {
    if (typeof options !== "object" && typeof options !== "function") {
      throw typeError("Failed to execute 'values' on 'ReadableStream': " +
          "options must be an object.");
    }
  }
  const preventCancel = false;
  if (options !== undefined && options !== null) {
    var pc = options.preventCancel; // may throw
    if (pc !== undefined) {
      preventCancel = !!pc;
    }
  }
  const reader = acquireReadableStreamDefaultReader(this);
  const iterator = Object.create(readableStreamIteratorPrototype);
  iterator[kIteratorReader] = reader;
  iterator[kPreventCancel] = preventCancel;
  return iterator;
};

Object.defineProperty(ReadableStream.prototype, kAsyncIterator, {
  value: function () {
    return this.values();
  },
  enumerable: false,
  writable: true,
  configurable: true,
});

// ======================================================================
// Teeing
// ======================================================================

// ReadableStreamTee(stream) / ReadableStreamDefaultTee(stream,
// cloneForBranch2)
function readableStreamDefaultTee(stream, cloneForBranch2) {
  var reader = acquireReadableStreamDefaultReader(stream);
  var reading = false;
  var readAgain = false;
  var canceled1 = false;
  var canceled2 = false;
  var reason1 = undefined;
  var reason2 = undefined;
  var branch1 = undefined;
  var branch2 = undefined;
  var cancelResolve;
  var cancelPromise = new Promise(function (resolve) {
    cancelResolve = resolve;
  });

  function pullAlgorithm() {
    if (reading) {
      readAgain = true;
      return Promise.resolve(undefined);
    }
    reading = true;
    const readRequest = {
      chunk: function (chunk) {
        // The microtask delay here is necessary because it takes at
        // least a microtask to detect errors via [[closedPromise]]
        // below.
        queueMicrotask(function () {
          readAgain = false;
          const chunk1 = chunk;
          const chunk2 = chunk;
          if (!canceled1) {
            defaultControllerEnqueue(branch1[kController], chunk1);
          }
          if (!canceled2) {
            defaultControllerEnqueue(branch2[kController], chunk2);
          }
          reading = false;
          if (readAgain) {
            pullAlgorithm();
          }
        });
      },
      close: function () {
        reading = false;
        if (!canceled1) {
          defaultControllerClose(branch1[kController]);
        }
        if (!canceled2) {
          defaultControllerClose(branch2[kController]);
        }
        if (!canceled1 || !canceled2) {
          cancelResolve(undefined);
        }
      },
      error: function () {
        reading = false;
      },
    };
    defaultReaderRead(reader, readRequest);
    return Promise.resolve(undefined);
  }

  function cancel1Algorithm(reason) {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) {
      const compositeReason = [reason1, reason2];
      const cancelResult = readableStreamCancel(stream, compositeReason);
      cancelResolve(cancelResult);
    }
    return cancelPromise;
  }

  function cancel2Algorithm(reason) {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) {
      const compositeReason = [reason1, reason2];
      const cancelResult = readableStreamCancel(stream, compositeReason);
      cancelResolve(cancelResult);
    }
    return cancelPromise;
  }

  var startAlgorithm = function () {
    return undefined;
  };
  branch1 = createReadableStream(startAlgorithm, pullAlgorithm, cancel1Algorithm);
  branch2 = createReadableStream(startAlgorithm, pullAlgorithm, cancel2Algorithm);

  reader[kClosedPromise].promise.then(
      undefined,
      function (r) {
        defaultControllerError(branch1[kController], r);
        defaultControllerError(branch2[kController], r);
        if (!canceled1 || !canceled2) {
          cancelResolve(undefined);
        }
      }
  );

  return [branch1, branch2];
}

// ======================================================================
// ReadableStream.from (async sequences)
// ======================================================================

// GetIterator(value, "async")
function getAsyncIterator(value) {
  if (value === null || value === undefined) {
    throw typeError("value is not an async iterable");
  }
  const method = value[kAsyncIterator]; // may throw
  if (method === undefined) {
    throw typeError("value is not an async iterable");
  }
  const iterator = method.call(value); // may throw
  if (iterator === null || (typeof iterator !== "object" && typeof iterator !== "function")) {
    throw typeError("value is not an async iterable");
  }
  iterator[kIteratorDone] = false;
  return iterator;
}

// "Opening an async sequence" |value|: returns an iterator, or a promise
// of one when |value| is a promise.
function openAsyncSequence(value) {
  if (value instanceof Promise) {
    return value.then(
        function (v) {
          return openAsyncSequence(v);
        },
        function (e) {
          throw e;
        }
    );
  }
  return getAsyncIterator(value);
}

// "Getting the next value" of |iterator|, which may be a promise of an
// iterator. Resolves with a value, kEndOfIteration, or rejects.
function getIteratorNextValue(iterator) {
  if (iterator instanceof Promise) {
    return iterator.then(
        function (it) {
          return getIteratorNextValue(it);
        },
        function (e) {
          throw e;
        }
    );
  }
  var next = iterator.next; // may throw
  var nextResult;
  try {
    nextResult = next.call(iterator); // may throw
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(nextResult).then(
      function (v) {
        if (v === null || (typeof v !== "object" && typeof v !== "function")) {
          throw typeError("iterator result is not an object");
        }
        if (!!v.done) {
          iterator[kIteratorDone] = true;
          return kEndOfIteration;
        }
        return v.value;
      }
  );
}

// "Closing" |iterator| (which may be a promise of an iterator) with
// |reason|.
function closeIterator(iterator, reason) {
  if (iterator instanceof Promise) {
    return iterator.then(
        function (it) {
          return closeIterator(it, reason);
        },
        function (e) {
          throw e;
        }
    );
  }
  if (iterator[kIteratorDone]) {
    return Promise.resolve(undefined);
  }
  iterator[kIteratorDone] = true;
  const method = iterator["return"]; // may throw
  if (method === undefined) {
    return Promise.resolve(undefined);
  }
  var result;
  try {
    result = method.call(iterator, reason); // may throw
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(result);
}

// ReadableStreamFromIterable(asyncIterable)
function readableStreamFromIterable(asyncIterable) {
  var stream = undefined;
  var iteratorOrPromise = openAsyncSequence(asyncIterable);
  var startAlgorithm = function () {
    return undefined;
  };
  const pullAlgorithm = function () {
    const nextPromise = getIteratorNextValue(iteratorOrPromise);
    return nextPromise.then(
        function (v) {
          if (v === kEndOfIteration) {
            defaultControllerClose(stream[kController]);
          } else {
            defaultControllerEnqueue(stream[kController], v);
          }
        },
        function (r) {
          defaultControllerError(stream[kController], r);
        }
    );
  };
  const cancelAlgorithm = function (reason) {
    return closeIterator(iteratorOrPromise, reason);
  };
  stream = createReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, 0);
  return stream;
}

// ======================================================================
// Exports
// ======================================================================

exports.ReadableStream = ReadableStream;
exports.ReadableStreamDefaultReader = ReadableStreamDefaultReader;
exports.ReadableStreamDefaultController = ReadableStreamDefaultController;
exports.CountQueuingStrategy = CountQueuingStrategy;
exports.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
