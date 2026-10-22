// WHATWG Streams: readable and writable streams, transform streams, and
// queuing strategies.
//
// Implements the ReadableStream class (with its default controller and
// default reader), the ReadableStreamDefaultReader class, the
// ReadableStream.from() static, ReadableStream.tee(), and asynchronous
// iteration over readable streams; the WritableStream class (with its
// default controller and default writer); the TransformStream class
// (with its default controller); ReadableStream.pipeTo() (piping) and
// ReadableStream.pipeThrough(); and the CountQueuingStrategy and
// ByteLengthQueuingStrategy built-in queuing strategies, as specified in
// the WHATWG Streams standard (specs/streams.bs).
//
// Readable byte streams (type: "bytes") are not implemented yet.

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

// WritableStream slots.
const kWriter = Symbol("writer");
const kInFlightWriteRequest = Symbol("inFlightWriteRequest");
const kInFlightCloseRequest = Symbol("inFlightCloseRequest");
const kCloseRequest = Symbol("closeRequest");
const kPendingAbortRequest = Symbol("pendingAbortRequest");
const kWriteRequests = Symbol("writeRequests");
const kBackpressure = Symbol("backpressure");

// WritableStreamDefaultController slots.
const kWriteAlgorithm = Symbol("writeAlgorithm");
const kCloseAlgorithm = Symbol("closeAlgorithm");
const kAbortAlgorithm = Symbol("abortAlgorithm");
const kAbortController = Symbol("abortController");

// WritableStreamDefaultWriter slots.
const kReadyPromise = Symbol("readyPromise");

// Sentinel enqueued into a writable stream's queue in lieu of a chunk to
// signal that the stream is closed.
const kCloseSentinel = Symbol("closeSentinel");

// TransformStream slots. (kController and kBackpressure are shared with
// the same-named slots; they live on different objects.)
const kReadable = Symbol("readable");
const kWritable = Symbol("writable");
const kBackpressureChangePromise = Symbol("backpressureChangePromise");

// TransformStreamDefaultController slots. (kStream and kCancelAlgorithm
// are shared with the same-named slots of the other controllers.)
const kFinishPromise = Symbol("finishPromise");
const kTransformAlgorithm = Symbol("transformAlgorithm");
const kFlushAlgorithm = Symbol("flushAlgorithm");

// Queue a microtask (the spec's "perform a microtask checkpoint"). The
// native binding enqueues the job directly on the engine's microtask queue
// (Context.enqueueMicrotask), the same queue the engine schedules Promise
// reactions on, rather than routing it through the Promise machinery.
const queueMicrotask = getBinding("microtask").queueMicrotask;

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
  if (size !== size || size < 0) {
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

// Promises that the stream state algorithms must settle (a reader's
// [[closedPromise]], a writer's [[readyPromise]]/[[closedPromise]], an
// in-flight write or close request) are kept as holder objects so that
// the algorithms can reach the settle functions, which the promise
// itself cannot expose. Holders for promises that are already settled
// have no-op settle functions. |pending| mirrors the promise's
// [[PromiseState]] so that the "ensure rejected" steps can tell whether
// to reject in place or replace the promise.
function makeSettledPromiseHolder(promise) {
  return {
    promise: promise,
    resolve: function () {},
    reject: function () {},
    pending: false,
  };
}

function makePendingPromiseHolder() {
  const holder = {
    promise: undefined,
    resolve: undefined,
    reject: undefined,
    pending: true,
  };
  holder.promise = new Promise(function (resolve, reject) {
    holder.resolve = function (v) {
      holder.pending = false;
      resolve(v);
    };
    holder.reject = function (e) {
      holder.pending = false;
      reject(e);
    };
  });
  return holder;
}

// ReadableStreamReaderGenericInitialize(reader, stream)
function readerGenericInitialize(reader, stream) {
  reader[kStream] = stream;
  stream[kReader] = reader;
  const state = stream[kState];
  if (state === "readable") {
    reader[kClosedPromise] = makePendingPromiseHolder();
  } else if (state === "closed") {
    reader[kClosedPromise] = makeSettledPromiseHolder(Promise.resolve(undefined));
  } else {
    reader[kClosedPromise] = makeSettledPromiseHolder(Promise.reject(stream[kStoredError]));
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
    reader[kClosedPromise] = makeSettledPromiseHolder(
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
  return new Promise(function (resolve, reject) {
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
    if (highWaterMarkValue !== highWaterMarkValue || highWaterMarkValue < 0) {
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
  let preventCancel = false;
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
// WritableStream: core state and stream-level algorithms
// ======================================================================

// InitializeWritableStream(stream)
function initializeWritableStream(stream) {
  stream[kState] = "writable";
  stream[kStoredError] = undefined;
  stream[kWriter] = undefined;
  stream[kController] = undefined;
  stream[kInFlightWriteRequest] = undefined;
  stream[kInFlightCloseRequest] = undefined;
  stream[kCloseRequest] = undefined;
  stream[kPendingAbortRequest] = undefined;
  stream[kWriteRequests] = [];
  stream[kBackpressure] = false;
}

// IsWritableStreamLocked(stream)
function isWritableStreamLocked(stream) {
  return stream[kWriter] !== undefined;
}

// Brand check: is this object a WritableStream (or subclass) instance?
function isWritableStream(object) {
  return object !== null &&
      typeof object === "object" &&
      object[kBackpressure] !== undefined;
}

// WritableStreamCloseQueuedOrInFlight(stream)
function writableStreamCloseQueuedOrInFlight(stream) {
  return stream[kCloseRequest] !== undefined || stream[kInFlightCloseRequest] !== undefined;
}

// WritableStreamHasOperationMarkedInFlight(stream)
function writableStreamHasOperationMarkedInFlight(stream) {
  return stream[kInFlightWriteRequest] !== undefined ||
      stream[kInFlightCloseRequest] !== undefined;
}

// WritableStreamAddWriteRequest(stream)
function writableStreamAddWriteRequest(stream) {
  const holder = makePendingPromiseHolder();
  stream[kWriteRequests].push(holder);
  return holder.promise;
}

// WritableStreamDealWithRejection(stream, error)
function writableStreamDealWithRejection(stream, error) {
  if (stream[kState] === "writable") {
    writableStreamStartErroring(stream, error);
    return;
  }
  // State is "erroring".
  writableStreamFinishErroring(stream);
}

// WritableStreamStartErroring(stream, reason)
function writableStreamStartErroring(stream, reason) {
  const controller = stream[kController];
  stream[kState] = "erroring";
  stream[kStoredError] = reason;
  const writer = stream[kWriter];
  if (writer !== undefined) {
    writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);
  }
  if (!writableStreamHasOperationMarkedInFlight(stream) && controller[kStarted]) {
    writableStreamFinishErroring(stream);
  }
}

// WritableStreamFinishErroring(stream)
function writableStreamFinishErroring(stream) {
  stream[kState] = "errored";
  const controller = stream[kController];
  // [[ErrorSteps]](): ResetQueue(controller)
  resetQueue(controller);
  const storedError = stream[kStoredError];
  const writeRequests = stream[kWriteRequests];
  stream[kWriteRequests] = [];
  for (var i = 0; i < writeRequests.length; i++) {
    writeRequests[i].reject(storedError);
  }
  const abortRequest = stream[kPendingAbortRequest];
  stream[kPendingAbortRequest] = undefined;
  if (abortRequest === undefined) {
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  // The abort happened while the stream was already erroring, so the
  // abort algorithm is never run; the request is rejected with the
  // error that is already in flight. (Running the algorithm here would
  // also be wrong after the controller's error() already cleared it.)
  if (abortRequest.wasAlreadyErroring) {
    abortRequest.reject(storedError);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  const promise = writableDefaultControllerAbortSteps(controller, abortRequest.reason);
  promise.then(
      function () {
        abortRequest.resolve(undefined);
        writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
      },
      function (reason) {
        abortRequest.reject(reason);
        writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
      }
  );
}

// WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream)
function writableStreamRejectCloseAndClosedPromiseIfNeeded(stream) {
  if (stream[kCloseRequest] !== undefined) {
    stream[kCloseRequest].reject(stream[kStoredError]);
    stream[kCloseRequest] = undefined;
  }
  const writer = stream[kWriter];
  if (writer !== undefined) {
    writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, stream[kStoredError]);
  }
}

// WritableStreamMarkFirstWriteRequestInFlight(stream)
function writableStreamMarkFirstWriteRequestInFlight(stream) {
  stream[kInFlightWriteRequest] = stream[kWriteRequests].shift();
}

// WritableStreamMarkCloseRequestInFlight(stream)
function writableStreamMarkCloseRequestInFlight(stream) {
  stream[kInFlightCloseRequest] = stream[kCloseRequest];
  stream[kCloseRequest] = undefined;
}

// WritableStreamFinishInFlightWrite(stream)
function writableStreamFinishInFlightWrite(stream) {
  stream[kInFlightWriteRequest].resolve(undefined);
  stream[kInFlightWriteRequest] = undefined;
}

// WritableStreamFinishInFlightWriteWithError(stream, error)
function writableStreamFinishInFlightWriteWithError(stream, error) {
  stream[kInFlightWriteRequest].reject(error);
  stream[kInFlightWriteRequest] = undefined;
  writableStreamDealWithRejection(stream, error);
}

// WritableStreamFinishInFlightClose(stream)
function writableStreamFinishInFlightClose(stream) {
  stream[kInFlightCloseRequest].resolve(undefined);
  stream[kInFlightCloseRequest] = undefined;
  if (stream[kState] === "erroring") {
    stream[kStoredError] = undefined;
    const abortRequest = stream[kPendingAbortRequest];
    if (abortRequest !== undefined) {
      abortRequest.resolve(undefined);
      stream[kPendingAbortRequest] = undefined;
    }
  }
  stream[kState] = "closed";
  const writer = stream[kWriter];
  if (writer !== undefined) {
    writer[kClosedPromise].resolve(undefined);
  }
}

// WritableStreamFinishInFlightCloseWithError(stream, error)
function writableStreamFinishInFlightCloseWithError(stream, error) {
  stream[kInFlightCloseRequest].reject(error);
  stream[kInFlightCloseRequest] = undefined;
  const abortRequest = stream[kPendingAbortRequest];
  if (abortRequest !== undefined) {
    abortRequest.reject(error);
    stream[kPendingAbortRequest] = undefined;
  }
  writableStreamDealWithRejection(stream, error);
}

// WritableStreamUpdateBackpressure(stream, backpressure)
function writableStreamUpdateBackpressure(stream, backpressure) {
  const writer = stream[kWriter];
  if (writer !== undefined && backpressure !== stream[kBackpressure]) {
    if (backpressure) {
      writer[kReadyPromise] = makePendingPromiseHolder();
    } else {
      writer[kReadyPromise].resolve(undefined);
    }
  }
  stream[kBackpressure] = backpressure;
}

// WritableStreamAbort(stream, reason)
function writableStreamAbort(stream, reason) {
  if (stream[kState] === "closed" || stream[kState] === "errored") {
    return Promise.resolve(undefined);
  }
  // Signal abort on the controller's AbortController with reason. This
  // runs author code (the signal's "abort" event listeners), which might
  // change the stream's state, so the state is re-checked below.
  stream[kController][kAbortController].abort(reason);
  const state = stream[kState];
  if (state === "closed" || state === "errored") {
    return Promise.resolve(undefined);
  }
  const pendingAbortRequest = stream[kPendingAbortRequest];
  if (pendingAbortRequest !== undefined) {
    return pendingAbortRequest.promise;
  }
  // State is "writable" or "erroring".
  let wasAlreadyErroring = false;
  if (state === "erroring") {
    wasAlreadyErroring = true;
    reason = undefined;
  }
  const holder = makePendingPromiseHolder();
  stream[kPendingAbortRequest] = {
    promise: holder.promise,
    resolve: holder.resolve,
    reject: holder.reject,
    reason: reason,
    wasAlreadyErroring: wasAlreadyErroring,
  };
  if (!wasAlreadyErroring) {
    writableStreamStartErroring(stream, reason);
  }
  return holder.promise;
}

// WritableStreamClose(stream)
function writableStreamClose(stream) {
  const state = stream[kState];
  if (state === "closed" || state === "errored") {
    return Promise.reject(
        typeError("WritableStream.close can only be used once"));
  }
  // State is "writable" or "erroring".
  const holder = makePendingPromiseHolder();
  stream[kCloseRequest] = holder;
  const writer = stream[kWriter];
  if (writer !== undefined && stream[kBackpressure] && state === "writable") {
    writer[kReadyPromise].resolve(undefined);
  }
  writableDefaultControllerClose(stream[kController]);
  return holder.promise;
}

// ======================================================================
// WritableStreamDefaultController
// ======================================================================

// WritableStreamDefaultControllerClearAlgorithms(controller)
function writableDefaultControllerClearAlgorithms(controller) {
  controller[kWriteAlgorithm] = undefined;
  controller[kCloseAlgorithm] = undefined;
  controller[kAbortAlgorithm] = undefined;
  controller[kStrategySizeAlgorithm] = undefined;
}

// WritableStreamDefaultControllerGetDesiredSize(controller)
function writableDefaultControllerGetDesiredSize(controller) {
  return controller[kStrategyHighWaterMark] - controller[kQueueTotalSize];
}

// WritableStreamDefaultControllerGetBackpressure(controller)
function writableDefaultControllerGetBackpressure(controller) {
  return writableDefaultControllerGetDesiredSize(controller) <= 0;
}

// [[AbortSteps]](reason)
function writableDefaultControllerAbortSteps(controller, reason) {
  const result = controller[kAbortAlgorithm](reason);
  writableDefaultControllerClearAlgorithms(controller);
  return result;
}

// WritableStreamDefaultControllerError(controller, e)
function writableDefaultControllerError(controller, e) {
  const stream = controller[kStream];
  writableDefaultControllerClearAlgorithms(controller);
  writableStreamStartErroring(stream, e);
}

// WritableStreamDefaultControllerErrorIfNeeded(controller, error)
function writableDefaultControllerErrorIfNeeded(controller, error) {
  if (controller[kStream][kState] === "writable") {
    writableDefaultControllerError(controller, error);
  }
}

// WritableStreamDefaultControllerGetChunkSize(controller, chunk)
function writableDefaultControllerGetChunkSize(controller, chunk) {
  const sizeAlgorithm = controller[kStrategySizeAlgorithm];
  if (sizeAlgorithm === undefined) {
    // The algorithms were cleared, so the stream is not writable.
    return 1;
  }
  let returnValue;
  try {
    returnValue = sizeAlgorithm(chunk);
  } catch (e) {
    writableDefaultControllerErrorIfNeeded(controller, e);
    return 1;
  }
  return returnValue;
}

// WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller)
function writableDefaultControllerAdvanceQueueIfNeeded(controller) {
  const stream = controller[kStream];
  if (!controller[kStarted]) {
    return;
  }
  if (stream[kInFlightWriteRequest] !== undefined) {
    return;
  }
  const state = stream[kState];
  if (state === "erroring") {
    writableStreamFinishErroring(stream);
    return;
  }
  if (controller[kQueue].length === 0) {
    return;
  }
  // PeekQueueValue(controller)
  const value = controller[kQueue][0][0];
  if (value === kCloseSentinel) {
    writableDefaultControllerProcessClose(controller);
  } else {
    writableDefaultControllerProcessWrite(controller, value);
  }
}

// WritableStreamDefaultControllerProcessWrite(controller, chunk)
function writableDefaultControllerProcessWrite(controller, chunk) {
  const stream = controller[kStream];
  writableStreamMarkFirstWriteRequestInFlight(stream);
  const sinkWritePromise = controller[kWriteAlgorithm](chunk);
  sinkWritePromise.then(
      function () {
        writableStreamFinishInFlightWrite(stream);
        const state = stream[kState];
        dequeueValue(controller);
        if (!writableStreamCloseQueuedOrInFlight(stream) && state === "writable") {
          writableStreamUpdateBackpressure(stream,
              writableDefaultControllerGetBackpressure(controller));
        }
        writableDefaultControllerAdvanceQueueIfNeeded(controller);
      },
      function (reason) {
        if (stream[kState] === "writable") {
          writableDefaultControllerClearAlgorithms(controller);
        }
        writableStreamFinishInFlightWriteWithError(stream, reason);
      }
  );
}

// WritableStreamDefaultControllerProcessClose(controller)
function writableDefaultControllerProcessClose(controller) {
  const stream = controller[kStream];
  writableStreamMarkCloseRequestInFlight(stream);
  dequeueValue(controller);
  const sinkClosePromise = controller[kCloseAlgorithm]();
  writableDefaultControllerClearAlgorithms(controller);
  sinkClosePromise.then(
      function () {
        writableStreamFinishInFlightClose(stream);
      },
      function (reason) {
        writableStreamFinishInFlightCloseWithError(stream, reason);
      }
  );
}

// WritableStreamDefaultControllerClose(controller)
function writableDefaultControllerClose(controller) {
  enqueueValueWithSize(controller, kCloseSentinel, 0);
  writableDefaultControllerAdvanceQueueIfNeeded(controller);
}

// WritableStreamDefaultControllerWrite(controller, chunk, chunkSize)
function writableDefaultControllerWrite(controller, chunk, chunkSize) {
  try {
    enqueueValueWithSize(controller, chunk, chunkSize);
  } catch (e) {
    writableDefaultControllerErrorIfNeeded(controller, e);
    return;
  }
  const stream = controller[kStream];
  if (!writableStreamCloseQueuedOrInFlight(stream) && stream[kState] === "writable") {
    writableStreamUpdateBackpressure(stream,
        writableDefaultControllerGetBackpressure(controller));
  }
  writableDefaultControllerAdvanceQueueIfNeeded(controller);
}

// SetUpWritableStreamDefaultController(stream, controller, startAlgorithm,
// writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark,
// sizeAlgorithm)
function setUpWritableDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm
) {
  controller[kStream] = stream;
  stream[kController] = controller;
  resetQueue(controller);
  controller[kAbortController] = new AbortController();
  controller[kStarted] = false;
  controller[kStrategySizeAlgorithm] = sizeAlgorithm;
  controller[kStrategyHighWaterMark] = highWaterMark;
  controller[kWriteAlgorithm] = writeAlgorithm;
  controller[kCloseAlgorithm] = closeAlgorithm;
  controller[kAbortAlgorithm] = abortAlgorithm;
  const backpressure = writableDefaultControllerGetBackpressure(controller);
  writableStreamUpdateBackpressure(stream, backpressure);
  const startResult = startAlgorithm(); // may throw
  const startPromise = Promise.resolve(startResult);
  startPromise.then(
      function () {
        controller[kStarted] = true;
        writableDefaultControllerAdvanceQueueIfNeeded(controller);
      },
      function (r) {
        controller[kStarted] = true;
        writableStreamDealWithRejection(stream, r);
      }
  );
}

// SetUpWritableStreamDefaultControllerFromUnderlyingSink(stream, startFn,
// writeFn, closeFn, abortFn, highWaterMark, sizeAlgorithm)
//
// |startFn|, |writeFn|, |closeFn|, and |abortFn| are the underlying
// sink's methods already converted and bound by the constructor (each
// either a bound function or undefined).
function setUpWritableDefaultControllerFromUnderlyingSink(
    stream,
    startFn,
    writeFn,
    closeFn,
    abortFn,
    highWaterMark,
    sizeAlgorithm
) {
  const controller = Object.create(WritableStreamDefaultController.prototype);

  var startAlgorithm = function () {
    return undefined;
  };
  var writeAlgorithm = function () {
    return Promise.resolve(undefined);
  };
  var closeAlgorithm = function () {
    return Promise.resolve(undefined);
  };
  var abortAlgorithm = function () {
    return Promise.resolve(undefined);
  };

  if (startFn !== undefined) {
    startAlgorithm = function () {
      return startFn(controller); // may throw
    };
  }
  if (writeFn !== undefined) {
    writeAlgorithm = function (chunk) {
      try {
        return Promise.resolve(writeFn(chunk, controller));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  if (closeFn !== undefined) {
    closeAlgorithm = function () {
      try {
        return Promise.resolve(closeFn());
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  if (abortFn !== undefined) {
    abortAlgorithm = function (reason) {
      try {
        return Promise.resolve(abortFn(reason));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }

  setUpWritableDefaultController(
      stream,
      controller,
      startAlgorithm,
      writeAlgorithm,
      closeAlgorithm,
      abortAlgorithm,
      highWaterMark,
      sizeAlgorithm
  );
}

// The public controller interface. The object is created internally by
// the stream implementation; the constructor exists for the Web IDL
// surface only.
function WritableStreamDefaultController() {
  throw typeError("WritableStreamDefaultController instances cannot be created directly.");
}

Object.defineProperty(WritableStreamDefaultController.prototype, "signal", {
  get: function () {
    return this[kAbortController].signal;
  },
  enumerable: false,
  configurable: true,
});

WritableStreamDefaultController.prototype.error = function (e) {
  const stream = this[kStream];
  if (stream[kState] !== "writable") {
    return;
  }
  writableDefaultControllerError(this, e);
};

// ======================================================================
// WritableStreamDefaultWriter
// ======================================================================

// WritableStreamDefaultWriterGetDesiredSize(writer)
function writableStreamDefaultWriterGetDesiredSize(writer) {
  const stream = writer[kStream];
  const state = stream[kState];
  if (state === "errored" || state === "erroring") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return writableDefaultControllerGetDesiredSize(stream[kController]);
}

// WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, error)
function writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, error) {
  const holder = writer[kReadyPromise];
  if (holder.pending) {
    holder.reject(error);
  } else {
    writer[kReadyPromise] = makeSettledPromiseHolder(Promise.reject(error));
    writer[kReadyPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
  }
}

// WritableStreamDefaultWriterEnsureClosedPromiseRejected(writer, error)
function writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, error) {
  const holder = writer[kClosedPromise];
  if (holder.pending) {
    holder.reject(error);
  } else {
    writer[kClosedPromise] = makeSettledPromiseHolder(Promise.reject(error));
    writer[kClosedPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
  }
}

// WritableStreamDefaultWriterRelease(writer)
function writableStreamDefaultWriterRelease(writer) {
  const stream = writer[kStream];
  const releasedError =
      typeError("WritableStreamDefaultWriter.releaseLock can only be used when owned");
  writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError);
  writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError);
  stream[kWriter] = undefined;
  writer[kStream] = undefined;
}

// WritableStreamDefaultWriterWrite(writer, chunk)
function writableStreamDefaultWriterWrite(writer, chunk) {
  const stream = writer[kStream];
  const controller = stream[kController];
  const chunkSize = writableDefaultControllerGetChunkSize(controller, chunk);
  // GetChunkSize runs the strategy's size function, which is author code
  // that might release the writer's lock.
  if (stream !== writer[kStream]) {
    return Promise.reject(
        typeError("WritableStreamDefaultWriter.write can only be used on active writers"));
  }
  const state = stream[kState];
  if (state === "errored") {
    return Promise.reject(stream[kStoredError]);
  }
  if (writableStreamCloseQueuedOrInFlight(stream) || state === "closed") {
    return Promise.reject(
        typeError("WritableStream is closing or closed; cannot write to it"));
  }
  if (state === "erroring") {
    return Promise.reject(stream[kStoredError]);
  }
  // State is "writable".
  const promise = writableStreamAddWriteRequest(stream);
  writableDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}

// WritableStreamDefaultWriterClose(writer)
function writableStreamDefaultWriterClose(writer) {
  const stream = writer[kStream];
  return writableStreamClose(stream);
}

// WritableStreamDefaultWriterAbort(writer, reason)
function writableStreamDefaultWriterAbort(writer, reason) {
  const stream = writer[kStream];
  return writableStreamAbort(stream, reason);
}

// WritableStreamDefaultWriterCloseWithErrorPropagation(writer)
//
// Needed by ReadableStream.pipeTo() once piping is implemented.
function writableStreamDefaultWriterCloseWithErrorPropagation(writer) {
  const stream = writer[kStream];
  const state = stream[kState];
  if (writableStreamCloseQueuedOrInFlight(stream) || state === "closed") {
    return Promise.resolve(undefined);
  }
  if (state === "errored") {
    return Promise.reject(stream[kStoredError]);
  }
  // State is "writable" or "erroring".
  return writableStreamClose(stream);
}

// SetUpWritableStreamDefaultWriter(writer, stream)
function setUpWritableStreamDefaultWriter(writer, stream) {
  if (isWritableStreamLocked(stream)) {
    throw typeError("Failed to construct 'WritableStreamDefaultWriter': " +
        "stream is already locked to a different writer object.");
  }
  writer[kStream] = stream;
  stream[kWriter] = writer;
  const state = stream[kState];
  if (state === "writable") {
    if (!writableStreamCloseQueuedOrInFlight(stream) && stream[kBackpressure]) {
      writer[kReadyPromise] = makePendingPromiseHolder();
    } else {
      writer[kReadyPromise] = makeSettledPromiseHolder(Promise.resolve(undefined));
    }
    writer[kClosedPromise] = makePendingPromiseHolder();
  } else if (state === "erroring") {
    writer[kReadyPromise] = makeSettledPromiseHolder(Promise.reject(stream[kStoredError]));
    writer[kReadyPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
    writer[kClosedPromise] = makePendingPromiseHolder();
  } else if (state === "closed") {
    writer[kReadyPromise] = makeSettledPromiseHolder(Promise.resolve(undefined));
    writer[kClosedPromise] = makeSettledPromiseHolder(Promise.resolve(undefined));
  } else {
    // State is "errored".
    const storedError = stream[kStoredError];
    writer[kReadyPromise] = makeSettledPromiseHolder(Promise.reject(storedError));
    writer[kReadyPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
    writer[kClosedPromise] = makeSettledPromiseHolder(Promise.reject(storedError));
    writer[kClosedPromise].promise.then(
        undefined,
        function () {}
    ); // mark the rejection as handled
  }
}

// AcquireWritableStreamDefaultWriter(stream)
function acquireWritableStreamDefaultWriter(stream) {
  const writer = Object.create(WritableStreamDefaultWriter.prototype);
  setUpWritableStreamDefaultWriter(writer, stream);
  return writer;
}

function WritableStreamDefaultWriter(stream) {
  if (!isWritableStream(stream)) {
    throw typeError(
        "Failed to construct 'WritableStreamDefaultWriter': argument is not a WritableStream.");
  }
  return acquireWritableStreamDefaultWriter(stream);
}

Object.defineProperty(WritableStreamDefaultWriter.prototype, "closed", {
  get: function () {
    return this[kClosedPromise].promise;
  },
  enumerable: false,
  configurable: true,
});

Object.defineProperty(WritableStreamDefaultWriter.prototype, "ready", {
  get: function () {
    return this[kReadyPromise].promise;
  },
  enumerable: false,
  configurable: true,
});

Object.defineProperty(WritableStreamDefaultWriter.prototype, "desiredSize", {
  get: function () {
    if (this[kStream] === undefined) {
      throw typeError(
          "WritableStreamDefaultWriter.desiredSize getter can only be used on active writers");
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  },
  enumerable: false,
  configurable: true,
});

WritableStreamDefaultWriter.prototype.abort = function (reason) {
  if (this[kStream] === undefined) {
    return Promise.reject(
        typeError("WritableStreamDefaultWriter.abort can only be used on active writers"));
  }
  return writableStreamDefaultWriterAbort(this, reason);
};

WritableStreamDefaultWriter.prototype.close = function () {
  if (this[kStream] === undefined) {
    return Promise.reject(
        typeError("WritableStreamDefaultWriter.close can only be used on active writers"));
  }
  if (writableStreamCloseQueuedOrInFlight(this[kStream])) {
    return Promise.reject(
        typeError("WritableStreamDefaultWriter.close can only be used once"));
  }
  return writableStreamDefaultWriterClose(this);
};

WritableStreamDefaultWriter.prototype.releaseLock = function () {
  if (this[kStream] === undefined) {
    return;
  }
  writableStreamDefaultWriterRelease(this);
};

WritableStreamDefaultWriter.prototype.write = function (chunk) {
  if (this[kStream] === undefined) {
    return Promise.reject(
        typeError("WritableStreamDefaultWriter.write can only be used on active writers"));
  }
  return writableStreamDefaultWriterWrite(this, chunk);
};

// ======================================================================
// WritableStream
// ======================================================================

function WritableStream(underlyingSink, strategy) {
  // IDL: underlyingSink is an optional object argument. null and
  // non-object values are not convertible; missing or undefined becomes
  // null.
  if (underlyingSink === null) {
    throw typeError("Failed to construct 'WritableStream': " +
        "underlyingSink must not be null.");
  }
  if (underlyingSink !== undefined &&
      typeof underlyingSink !== "object" &&
      typeof underlyingSink !== "function") {
    throw typeError("Failed to construct 'WritableStream': " +
        "underlyingSink must be an object.");
  }
  // IDL: strategy is an optional QueuingStrategy dictionary argument,
  // converted at the IDL layer, i.e. before the underlying sink's
  // properties are read in the method body.
  if (strategy === undefined || strategy === null) {
    strategy = {};
  }
  if (typeof strategy !== "object" && typeof strategy !== "function") {
    throw typeError("Failed to construct 'WritableStream': strategy must be an object.");
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

  if (underlyingSink === undefined) {
    underlyingSink = null;
  }

  // Convert the underlying sink to an UnderlyingSink dictionary
  // (members read in declaration order).
  var startFn;
  var writeFn;
  var closeFn;
  var abortFn;
  if (underlyingSink !== null) {
    startFn = underlyingSink.start; // may throw
    writeFn = underlyingSink.write; // may throw
    closeFn = underlyingSink.close; // may throw
    abortFn = underlyingSink.abort; // may throw
  }
  if (startFn !== undefined && typeof startFn !== "function") {
    throw typeError("Failed to convert argument 'start' of 'UnderlyingSink': " +
        "provided value is not a function.");
  }
  if (writeFn !== undefined && typeof writeFn !== "function") {
    throw typeError("Failed to convert argument 'write' of 'UnderlyingSink': " +
        "provided value is not a function.");
  }
  if (closeFn !== undefined && typeof closeFn !== "function") {
    throw typeError("Failed to convert argument 'close' of 'UnderlyingSink': " +
        "provided value is not a function.");
  }
  if (abortFn !== undefined && typeof abortFn !== "function") {
    throw typeError("Failed to convert argument 'abort' of 'UnderlyingSink': " +
        "provided value is not a function.");
  }
  // Bind the sink's methods to the underlying sink object, which is the
  // callback this value per the spec. Binding lets them be invoked
  // directly (via [[Call]]) rather than through Function.prototype.call
  // or .apply.
  if (startFn !== undefined) {
    startFn = startFn.bind(underlyingSink);
  }
  if (writeFn !== undefined) {
    writeFn = writeFn.bind(underlyingSink);
  }
  if (closeFn !== undefined) {
    closeFn = closeFn.bind(underlyingSink);
  }
  if (abortFn !== undefined) {
    abortFn = abortFn.bind(underlyingSink);
  }
  // The type member is reserved for future use.
  if (underlyingSink !== null && "type" in underlyingSink) {
    throw new RangeError(
        "Writable streams cannot have a type; it is reserved for future use.");
  }

  // InitializeWritableStream
  initializeWritableStream(this);

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
    if (highWaterMarkValue !== highWaterMarkValue || highWaterMarkValue < 0) {
      throw new RangeError("Invalid high water mark: " + highWaterMarkValue);
    }
    highWaterMark = highWaterMarkValue;
  }

  setUpWritableDefaultControllerFromUnderlyingSink(
      this, startFn, writeFn, closeFn, abortFn, highWaterMark, sizeAlgorithm);
}

Object.defineProperty(WritableStream.prototype, "locked", {
  get: function () {
    return isWritableStreamLocked(this);
  },
  enumerable: false,
  configurable: true,
});

WritableStream.prototype.abort = function (reason) {
  if (isWritableStreamLocked(this)) {
    return Promise.reject(
        typeError("WritableStream.abort can only be used on unlocked streams"));
  }
  return writableStreamAbort(this, reason);
};

WritableStream.prototype.close = function () {
  if (isWritableStreamLocked(this)) {
    return Promise.reject(
        typeError("WritableStream.close can only be used on unlocked streams"));
  }
  if (writableStreamCloseQueuedOrInFlight(this)) {
    return Promise.reject(
        typeError("WritableStream.close can only be used once"));
  }
  return writableStreamClose(this);
};

WritableStream.prototype.getWriter = function () {
  return acquireWritableStreamDefaultWriter(this);
};

// CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm,
// abortAlgorithm, highWaterMark, sizeAlgorithm)
//
// Internal construction path mirroring createReadableStream: the stream
// and its controller are created directly from the given algorithms,
// with no underlying sink object. Used by the TransformStream
// constructor.
function createWritableStream(
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm
) {
  const stream = Object.create(WritableStream.prototype);
  initializeWritableStream(stream);
  const controller = Object.create(WritableStreamDefaultController.prototype);
  setUpWritableDefaultController(
      stream,
      controller,
      startAlgorithm,
      writeAlgorithm,
      closeAlgorithm,
      abortAlgorithm,
      highWaterMark,
      sizeAlgorithm
  );
  return stream;
}

// ======================================================================
// Piping
// ======================================================================

// IsAbortSignal(object)
//
// The brand check distinguishes genuine platform signals from
// lookalikes (e.g. Object.create(AbortSignal.prototype)); when the
// platform provides no brand mechanism (a real browser), the instanceof
// check is the best available.
function isAbortSignal(object) {
  if (object === null || (typeof object !== "object" && typeof object !== "function")) {
    return false;
  }
  if (typeof AbortSignal === "undefined" || !(object instanceof AbortSignal)) {
    return false;
  }
  const brand = AbortSignal.brandSymbol;
  if (brand === undefined) {
    return true;
  }
  return object[brand] === true;
}

// ReadableStreamPipeTo(source, dest, preventClose, preventAbort,
// preventCancel, signal)
//
// "In parallel", read all chunks from |source| and write them to |dest|.
// The reader/writer locking means the pipe is driven purely by the
// streams' internal machinery: a loop that reads the next chunk whenever
// the destination's ready promise is fulfilled (enforcing backpressure),
// and "is or becomes errored/closed" observers on both streams that
// perform the spec's ordered shutdowns. The reference implementation of
// the standard (whatwg/streams) structures the pipe the same way; note
// in particular that reads are not serialized behind writes — the next
// read is issued as soon as the destination desires more, and chunks
// queue in the destination until in-flight writes settle.
function readableStreamPipeTo(source, dest, preventClose, preventAbort, preventCancel, signal) {
  const reader = acquireReadableStreamDefaultReader(source);
  const writer = acquireWritableStreamDefaultWriter(dest);
  source[kDisturbed] = true;

  let shuttingDown = false;
  // A promise that always fulfills, tracking the most recent write, so
  // that shutdown can wait for every in-flight write to settle.
  let currentWrite = Promise.resolve(undefined);
  const pipeHolder = makePendingPromiseHolder();

  function performFinalize(isError, error) {
    writableStreamDefaultWriterRelease(writer);
    defaultReaderRelease(reader);
    if (signal !== undefined) {
      signal.removeEventListener("abort", abortAlgorithm);
    }
    if (isError) {
      pipeHolder.reject(error);
    } else {
      pipeHolder.resolve(undefined);
    }
  }

  function waitForWritesToFinish() {
    // Another write may have started while we were waiting on this one.
    const oldCurrentWrite = currentWrite;
    return currentWrite.then(
        function () {
          if (oldCurrentWrite !== currentWrite) {
            return waitForWritesToFinish();
          }
          return undefined;
        }
    );
  }

  function performShutdownWithAction(action, isError, error) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (dest[kState] === "writable" && !writableStreamCloseQueuedOrInFlight(dest)) {
      waitForWritesToFinish().then(
          function () {
            uponPromise(action(), isError, error);
          }
      );
    } else {
      uponPromise(action(), isError, error);
    }
  }

  function performShutdown(isError, error) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (dest[kState] === "writable" && !writableStreamCloseQueuedOrInFlight(dest)) {
      waitForWritesToFinish().then(
          function () {
            performFinalize(isError, error);
          }
      );
    } else {
      performFinalize(isError, error);
    }
  }

  // Run the shutdown action: on fulfillment, finalize with the original
  // error (if any); on rejection, finalize with the action's error.
  function uponPromise(actionPromise, isError, error) {
    actionPromise.then(
        function () {
          performFinalize(isError, error);
        },
        function (newError) {
          performFinalize(true, newError);
        }
    );
  }

  // "Is or becomes errored" observers: if the stream is already errored,
  // the action runs now; otherwise it runs when the reader/writer's
  // closed promise is rejected (which happens exactly when the stream
  // errors, or when the lock is released during finalize — a no-op at
  // that point since shuttingDown is already true).
  function isOrBecomesErrored(stream, closedPromiseHolder, action) {
    if (stream[kState] === "errored") {
      action(stream[kStoredError]);
    } else {
      closedPromiseHolder.promise.then(
          undefined,
          function (e) {
            action(e);
          }
      );
    }
  }

  function isOrBecomesClosed(stream, closedPromiseHolder, action) {
    if (stream[kState] === "closed") {
      action();
    } else {
      closedPromiseHolder.promise.then(
          action,
          function () {}
      );
    }
  }

  function abortAlgorithm() {
    const error = signal.reason;
    const actions = [];
    if (!preventAbort) {
      actions.push(function () {
        if (dest[kState] === "writable") {
          return writableStreamAbort(dest, error);
        }
        return Promise.resolve(undefined);
      });
    }
    if (!preventCancel) {
      actions.push(function () {
        if (source[kState] === "readable") {
          return readableStreamCancel(source, error);
        }
        return Promise.resolve(undefined);
      });
    }
    performShutdownWithAction(
        function () {
          return Promise.all(
              actions.map(
                  function (action) {
                    return action();
                  }));
        },
        true,
        error);
  }

  if (signal !== undefined) {
    if (signal.aborted) {
      abortAlgorithm();
      return pipeHolder.promise;
    }
    signal.addEventListener("abort", abortAlgorithm);
  }

  function pipeStep() {
    if (shuttingDown) {
      return;
    }
    // Gate the next read on the destination's ready promise. When there
    // is no backpressure the promise is already fulfilled, but going
    // through it still defers the read by a microtask, which keeps the
    // pipe's activity off the synchronous call stacks of the streams'
    // state changes.
    writer[kReadyPromise].promise.then(
        function () {
          defaultReaderRead(reader, {
            chunk: function (chunk) {
              const writePromise = writableStreamDefaultWriterWrite(writer, chunk);
              currentWrite = writePromise.then(
                  undefined,
                  function () {}
              );
              // Issue the next read now (gated on the ready promise
              // again), without waiting for the write to settle; the
              // destination's internal queue and backpressure do the
              // pacing.
              pipeStep();
            },
            close: function () {
              // The source closed; the close observers perform the
              // shutdown. The loop ends.
            },
            error: function () {
              // The source errored; the error observers perform the
              // shutdown. The loop ends.
            },
          });
        },
        function () {
          // The ready promise was rejected (the destination errored).
          // Backward error propagation is handled by the observers
          // above; the loop ends.
        }
    );
  }

  // "Errors must be propagated forward".
  isOrBecomesErrored(
      source,
      reader[kClosedPromise],
      function (storedError) {
        if (!preventAbort) {
          performShutdownWithAction(
              function () {
                return writableStreamAbort(dest, storedError);
              },
              true,
              storedError);
        } else {
          performShutdown(true, storedError);
        }
      });

  // "Errors must be propagated backward".
  isOrBecomesErrored(
      dest,
      writer[kClosedPromise],
      function (storedError) {
        if (!preventCancel) {
          performShutdownWithAction(
              function () {
                return readableStreamCancel(source, storedError);
              },
              true,
              storedError);
        } else {
          performShutdown(true, storedError);
        }
      });

  // "Closing must be propagated forward".
  isOrBecomesClosed(
      source,
      reader[kClosedPromise],
      function () {
        if (!preventClose) {
          performShutdownWithAction(
              function () {
                return writableStreamDefaultWriterCloseWithErrorPropagation(writer);
              });
        } else {
          performShutdown();
        }
      });

  // "Closing must be propagated backward": the destination is closing or
  // closed before any chunk is read or written.
  if (writableStreamCloseQueuedOrInFlight(dest) || dest[kState] === "closed") {
    const destClosed =
        typeError("the destination writable stream closed before all data could be piped to it");
    if (!preventCancel) {
      performShutdownWithAction(
          function () {
            return readableStreamCancel(source, destClosed);
          },
          true,
          destClosed);
    } else {
      performShutdown(true, destClosed);
    }
  }

  pipeStep();

  return pipeHolder.promise;
}

ReadableStream.prototype.pipeTo = function (destination, options) {
  // IDL: destination is a WritableStream; a failed conversion is
  // reported as a rejected promise.
  if (!isWritableStream(destination)) {
    return Promise.reject(typeError(
        "Failed to execute 'pipeTo' on 'ReadableStream': argument is not a WritableStream."));
  }
  // Neither stream may be locked; the checks happen before anything is
  // acquired, so a failing pipeTo leaves both streams unlocked.
  if (isReadableStreamLocked(this)) {
    return Promise.reject(
        typeError("ReadableStream.prototype.pipeTo can only be used on unlocked streams"));
  }
  if (isWritableStreamLocked(destination)) {
    return Promise.reject(
        typeError("ReadableStream.prototype.pipeTo can only be used on unlocked streams"));
  }
  // IDL: options is a StreamPipeOptions dictionary, converted at the IDL
  // layer. Members are read in the order the WPT suite verifies
  // (preventAbort, preventCancel, preventClose, signal).
  let preventAbort = false;
  let preventCancel = false;
  let preventClose = false;
  let signal = undefined;
  if (options !== undefined && options !== null) {
    if (typeof options !== "object" && typeof options !== "function") {
      return Promise.reject(typeError(
          "Failed to execute 'pipeTo' on 'ReadableStream': options must be an object."));
    }
    try {
      preventAbort = !!options.preventAbort; // may throw via a getter
      preventCancel = !!options.preventCancel;
      preventClose = !!options.preventClose;
      signal = options.signal;
    } catch (e) {
      return Promise.reject(e);
    }
    if (signal !== undefined && !isAbortSignal(signal)) {
      return Promise.reject(typeError(
          "Failed to execute 'pipeTo' on 'ReadableStream': signal is not an AbortSignal."));
    }
  }
  try {
    return readableStreamPipeTo(
        this, destination, preventClose, preventAbort, preventCancel, signal);
  } catch (e) {
    return Promise.reject(e);
  }
};

ReadableStream.prototype.pipeThrough = function (transform, options) {
  // Web IDL brand check on `this`.
  if (!isReadableStream(this)) {
    throw typeError(
        "ReadableStream.prototype.pipeThrough can only be used on a ReadableStream.");
  }
  // IDL: transform is converted as a ReadableWritablePair dictionary:
  // the members are read in the order readable, writable, and each is
  // brand-checked. A getter that throws propagates that error.
  const transformReadable = transform.readable; // may throw
  if (!isReadableStream(transformReadable)) {
    throw typeError(
        "Failed to execute 'pipeThrough' on 'ReadableStream': readable is not a ReadableStream.");
  }
  const transformWritable = transform.writable; // may throw
  if (!isWritableStream(transformWritable)) {
    throw typeError(
        "Failed to execute 'pipeThrough' on 'ReadableStream': writable is not a WritableStream.");
  }
  // IDL: options is a StreamPipeOptions dictionary, converted at the IDL
  // layer. Members are read in the order the WPT suite verifies
  // (preventAbort, preventCancel, preventClose, signal).
  let preventAbort = false;
  let preventCancel = false;
  let preventClose = false;
  let signal = undefined;
  if (options !== undefined && options !== null) {
    if (typeof options !== "object" && typeof options !== "function") {
      throw typeError(
          "Failed to execute 'pipeThrough' on 'ReadableStream': options must be an object.");
    }
    preventAbort = !!options.preventAbort; // may throw via a getter
    preventCancel = !!options.preventCancel;
    preventClose = !!options.preventClose;
    signal = options.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw typeError(
          "Failed to execute 'pipeThrough' on 'ReadableStream': signal is not an AbortSignal.");
    }
  }
  // Neither stream may be locked; the checks happen after the argument
  // conversion, so a failing option getter that locks the writable side
  // still causes a throw.
  if (isReadableStreamLocked(this)) {
    throw typeError(
        "ReadableStream.prototype.pipeThrough can only be used on unlocked streams");
  }
  if (isWritableStreamLocked(transformWritable)) {
    throw typeError(
        "ReadableStream.prototype.pipeThrough can only be used on unlocked streams");
  }
  // The pipe is performed with the internal algorithm, not via
  // ReadableStream.prototype.pipeTo, which user code may have
  // overridden.
  const promise = readableStreamPipeTo(
      this, transformWritable, preventClose, preventAbort, preventCancel, signal);
  // Set promise.[[PromiseIsHandled]] to true: the pipe's fate is
  // observed through the readable side, so the promise itself never
  // escapes to user code.
  promise.then(
      undefined,
      function () {}
  );
  return transformReadable;
};

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
// TransformStream
// ======================================================================

// TransformStreamSetBackpressure(stream, backpressure)
function transformStreamSetBackpressure(stream, backpressure) {
  const old = stream[kBackpressureChangePromise];
  if (old !== undefined) {
    old.resolve(undefined);
  }
  stream[kBackpressureChangePromise] = makePendingPromiseHolder();
  stream[kBackpressure] = backpressure;
}

// TransformStreamUnblockWrite(stream)
function transformStreamUnblockWrite(stream) {
  if (stream[kBackpressure] === true) {
    transformStreamSetBackpressure(stream, false);
  }
}

// TransformStreamError(stream, e)
function transformStreamError(stream, e) {
  defaultControllerError(stream[kReadable][kController], e);
  transformStreamErrorWritableAndUnblockWrite(stream, e);
}

// TransformStreamErrorWritableAndUnblockWrite(stream, e)
function transformStreamErrorWritableAndUnblockWrite(stream, e) {
  transformStreamDefaultControllerClearAlgorithms(stream[kController]);
  writableDefaultControllerErrorIfNeeded(stream[kWritable][kController], e);
  transformStreamUnblockWrite(stream);
}

// TransformStreamDefaultControllerClearAlgorithms(controller)
function transformStreamDefaultControllerClearAlgorithms(controller) {
  controller[kTransformAlgorithm] = undefined;
  controller[kFlushAlgorithm] = undefined;
  controller[kCancelAlgorithm] = undefined;
}

// TransformStreamDefaultControllerEnqueue(controller, chunk). May throw
// a TypeError (readable side not enqueuable) or the readable side's
// stored error (e.g. when the strategy's size function throws).
function transformStreamDefaultControllerEnqueue(controller, chunk) {
  const stream = controller[kStream];
  const readableController = stream[kReadable][kController];
  if (!defaultControllerCanCloseOrEnqueue(readableController)) {
    throw typeError(
        "TransformStreamDefaultController.enqueue can only be used when not closed or errored");
  }
  try {
    defaultControllerEnqueue(readableController, chunk);
  } catch (e) {
    transformStreamErrorWritableAndUnblockWrite(stream, e);
    throw stream[kReadable][kStoredError];
  }
  // ReadableStreamDefaultControllerHasBackpressure(readableController):
  // the readable side has backpressure when it does not want to pull.
  if (!defaultControllerShouldCallPull(readableController) &&
      stream[kBackpressure] !== true) {
    transformStreamSetBackpressure(stream, true);
  }
}

// TransformStreamDefaultControllerPerformTransform(controller, chunk)
function transformStreamDefaultControllerPerformTransform(controller, chunk) {
  const stream = controller[kStream];
  const transformPromise = controller[kTransformAlgorithm](chunk);
  return Promise.resolve(transformPromise).then(
      undefined,
      function (r) {
        transformStreamError(stream, r);
        throw r;
      }
  );
}

// TransformStreamDefaultControllerTerminate(controller)
function transformStreamDefaultControllerTerminate(controller) {
  const stream = controller[kStream];
  defaultControllerClose(stream[kReadable][kController]);
  const error = typeError("TransformStream terminated");
  transformStreamErrorWritableAndUnblockWrite(stream, error);
}

// The public controller interface. The object is created internally by
// the stream implementation; the constructor exists for the Web IDL
// surface only.
function TransformStreamDefaultController() {
  throw typeError("TransformStreamDefaultController instances cannot be created directly.");
}

Object.defineProperty(TransformStreamDefaultController.prototype, "desiredSize", {
  get: function () {
    return defaultControllerGetDesiredSize(this[kStream][kReadable][kController]);
  },
  enumerable: false,
  configurable: true,
});

TransformStreamDefaultController.prototype.enqueue = function (chunk) {
  transformStreamDefaultControllerEnqueue(this, chunk);
};

TransformStreamDefaultController.prototype.error = function (e) {
  transformStreamError(this[kStream], e);
};

TransformStreamDefaultController.prototype.terminate = function () {
  transformStreamDefaultControllerTerminate(this);
};

// TransformStreamDefaultSinkWriteAlgorithm(stream, chunk)
function transformStreamDefaultSinkWriteAlgorithm(stream, chunk) {
  const controller = stream[kController];
  if (stream[kBackpressure] === true) {
    return stream[kBackpressureChangePromise].promise.then(
        function () {
          const writable = stream[kWritable];
          const state = writable[kState];
          if (state === "erroring") {
            throw writable[kStoredError];
          }
          // State is "writable".
          return transformStreamDefaultControllerPerformTransform(controller, chunk);
        }
    );
  }
  return transformStreamDefaultControllerPerformTransform(controller, chunk);
}

// TransformStreamDefaultSinkAbortAlgorithm(stream, reason)
function transformStreamDefaultSinkAbortAlgorithm(stream, reason) {
  const controller = stream[kController];
  const existingFinish = controller[kFinishPromise];
  if (existingFinish !== undefined) {
    return existingFinish.promise;
  }
  const readable = stream[kReadable];
  const finishHolder = makePendingPromiseHolder();
  controller[kFinishPromise] = finishHolder;
  const cancelPromise = controller[kCancelAlgorithm](reason);
  transformStreamDefaultControllerClearAlgorithms(controller);
  Promise.resolve(cancelPromise).then(
      function () {
        if (readable[kState] === "errored") {
          finishHolder.reject(readable[kStoredError]);
        } else {
          defaultControllerError(readable[kController], reason);
          finishHolder.resolve(undefined);
        }
      },
      function (r) {
        defaultControllerError(readable[kController], r);
        finishHolder.reject(r);
      }
  );
  return finishHolder.promise;
}

// TransformStreamDefaultSinkCloseAlgorithm(stream)
function transformStreamDefaultSinkCloseAlgorithm(stream) {
  const controller = stream[kController];
  const existingFinish = controller[kFinishPromise];
  if (existingFinish !== undefined) {
    return existingFinish.promise;
  }
  const readable = stream[kReadable];
  const finishHolder = makePendingPromiseHolder();
  controller[kFinishPromise] = finishHolder;
  const flushPromise = controller[kFlushAlgorithm]();
  transformStreamDefaultControllerClearAlgorithms(controller);
  Promise.resolve(flushPromise).then(
      function () {
        if (readable[kState] === "errored") {
          finishHolder.reject(readable[kStoredError]);
        } else {
          defaultControllerClose(readable[kController]);
          finishHolder.resolve(undefined);
        }
      },
      function (r) {
        defaultControllerError(readable[kController], r);
        finishHolder.reject(r);
      }
  );
  return finishHolder.promise;
}

// TransformStreamDefaultSourcePullAlgorithm(stream)
//
// Invariant: pull() is only called while the transform stream's
// backpressure is true. The invariant is enforced by the promises
// returned by start() and pull(): the pull promise is the
// backpressure change promise, which only resolves once the
// backpressure is true again, and the readable side never starts a new
// pull while one is in flight.
function transformStreamDefaultSourcePullAlgorithm(stream) {
  transformStreamSetBackpressure(stream, false);
  return stream[kBackpressureChangePromise].promise;
}

// TransformStreamDefaultSourceCancelAlgorithm(stream, reason)
function transformStreamDefaultSourceCancelAlgorithm(stream, reason) {
  const controller = stream[kController];
  const existingFinish = controller[kFinishPromise];
  if (existingFinish !== undefined) {
    return existingFinish.promise;
  }
  const writable = stream[kWritable];
  const finishHolder = makePendingPromiseHolder();
  controller[kFinishPromise] = finishHolder;
  const cancelPromise = controller[kCancelAlgorithm](reason);
  transformStreamDefaultControllerClearAlgorithms(controller);
  Promise.resolve(cancelPromise).then(
      function () {
        if (writable[kState] === "errored") {
          finishHolder.reject(writable[kStoredError]);
        } else {
          writableDefaultControllerErrorIfNeeded(writable[kController], reason);
          transformStreamUnblockWrite(stream);
          finishHolder.resolve(undefined);
        }
      },
      function (r) {
        writableDefaultControllerErrorIfNeeded(writable[kController], r);
        transformStreamUnblockWrite(stream);
        finishHolder.reject(r);
      }
  );
  return finishHolder.promise;
}

function TransformStream(transformer, writableStrategy, readableStrategy) {
  // IDL: transformer is an optional object argument. null and
  // non-object values are not convertible; missing or undefined becomes
  // null.
  if (transformer === null) {
    throw typeError("Failed to construct 'TransformStream': " +
        "transformer must not be null.");
  }
  if (transformer !== undefined &&
      typeof transformer !== "object" &&
      typeof transformer !== "function") {
    throw typeError("Failed to construct 'TransformStream': " +
        "transformer must be an object.");
  }
  // IDL: writableStrategy and readableStrategy are optional
  // QueuingStrategy dictionary arguments, converted at the IDL layer.
  if (writableStrategy === undefined || writableStrategy === null) {
    writableStrategy = {};
  }
  if (typeof writableStrategy !== "object" && typeof writableStrategy !== "function") {
    throw typeError("Failed to construct 'TransformStream': " +
        "writableStrategy must be an object.");
  }
  if (readableStrategy === undefined || readableStrategy === null) {
    readableStrategy = {};
  }
  if (typeof readableStrategy !== "object" && typeof readableStrategy !== "function") {
    throw typeError("Failed to construct 'TransformStream': " +
        "readableStrategy must be an object.");
  }

  if (transformer === undefined) {
    transformer = null;
  }

  // Convert the transformer to a Transformer dictionary (members read
  // in declaration order).
  var startFn;
  var transformFn;
  var flushFn;
  var cancelFn;
  if (transformer !== null) {
    startFn = transformer.start; // may throw
    transformFn = transformer.transform; // may throw
    flushFn = transformer.flush; // may throw
    cancelFn = transformer.cancel; // may throw
  }
  if (startFn !== undefined && typeof startFn !== "function") {
    throw typeError("Failed to convert argument 'start' of 'Transformer': " +
        "provided value is not a function.");
  }
  if (transformFn !== undefined && typeof transformFn !== "function") {
    throw typeError("Failed to convert argument 'transform' of 'Transformer': " +
        "provided value is not a function.");
  }
  if (flushFn !== undefined && typeof flushFn !== "function") {
    throw typeError("Failed to convert argument 'flush' of 'Transformer': " +
        "provided value is not a function.");
  }
  if (cancelFn !== undefined && typeof cancelFn !== "function") {
    throw typeError("Failed to convert argument 'cancel' of 'Transformer': " +
        "provided value is not a function.");
  }
  // The type members are reserved for future use.
  if (transformer !== null && "readableType" in transformer) {
    throw new RangeError("Invalid readableType specified");
  }
  if (transformer !== null && "writableType" in transformer) {
    throw new RangeError("Invalid writableType specified");
  }
  // Bind the transformer's methods to the transformer object, which is
  // the callback this value per the spec. Binding lets them be invoked
  // directly (via [[Call]]) rather than through Function.prototype.call
  // or .apply.
  if (startFn !== undefined) {
    startFn = startFn.bind(transformer);
  }
  if (transformFn !== undefined) {
    transformFn = transformFn.bind(transformer);
  }
  if (flushFn !== undefined) {
    flushFn = flushFn.bind(transformer);
  }
  if (cancelFn !== undefined) {
    cancelFn = cancelFn.bind(transformer);
  }

  // ExtractSizeAlgorithm / ExtractHighWaterMark; the readable strategy
  // is extracted before the writable strategy, and highWaterMark before
  // size within each.
  var readableHighWaterMarkValue = readableStrategy.highWaterMark; // may throw
  if (readableHighWaterMarkValue !== undefined) {
    readableHighWaterMarkValue = Number(readableHighWaterMarkValue);
  }
  var readableSizeValue = readableStrategy.size; // may throw
  if (readableSizeValue !== undefined && typeof readableSizeValue !== "function") {
    throw typeError(
        "Failed to convert argument 'size' of 'QueuingStrategy': provided value is not a function.");
  }
  var writableHighWaterMarkValue = writableStrategy.highWaterMark; // may throw
  if (writableHighWaterMarkValue !== undefined) {
    writableHighWaterMarkValue = Number(writableHighWaterMarkValue);
  }
  var writableSizeValue = writableStrategy.size; // may throw
  if (writableSizeValue !== undefined && typeof writableSizeValue !== "function") {
    throw typeError(
        "Failed to convert argument 'size' of 'QueuingStrategy': provided value is not a function.");
  }

  var readableSizeAlgorithm;
  if (readableSizeValue === undefined) {
    readableSizeAlgorithm = function () {
      return 1;
    };
  } else {
    readableSizeAlgorithm = function (chunk) {
      return readableSizeValue(chunk);
    };
  }
  var readableHighWaterMark;
  if (readableHighWaterMarkValue === undefined) {
    readableHighWaterMark = 0;
  } else {
    if (readableHighWaterMarkValue !== readableHighWaterMarkValue ||
        readableHighWaterMarkValue < 0) {
      throw new RangeError("Invalid high water mark: " + readableHighWaterMarkValue);
    }
    readableHighWaterMark = readableHighWaterMarkValue;
  }
  var writableSizeAlgorithm;
  if (writableSizeValue === undefined) {
    writableSizeAlgorithm = function () {
      return 1;
    };
  } else {
    writableSizeAlgorithm = function (chunk) {
      return writableSizeValue(chunk);
    };
  }
  var writableHighWaterMark;
  if (writableHighWaterMarkValue === undefined) {
    writableHighWaterMark = 1;
  } else {
    if (writableHighWaterMarkValue !== writableHighWaterMarkValue ||
        writableHighWaterMarkValue < 0) {
      throw new RangeError("Invalid high water mark: " + writableHighWaterMarkValue);
    }
    writableHighWaterMark = writableHighWaterMarkValue;
  }

  const stream = this;

  // InitializeTransformStream. Both sides share the start algorithm.
  // It returns an adoption wrapper (a promise that resolves with the
  // start promise) rather than the start promise itself, mirroring the
  // reference implementation's promiseResolvedWith(): the sides' start
  // reactions then run one microtask after the constructor resolves the
  // start promise, which preserves the spec's ordering of those
  // reactions relative to reactions scheduled synchronously after
  // construction (e.g. by a readable.cancel() in the same task).
  const startPromiseHolder = makePendingPromiseHolder();
  const startAlgorithm = function () {
    return new Promise(function (resolve) {
      resolve(startPromiseHolder.promise);
    });
  };
  const writeAlgorithm = function (chunk) {
    return transformStreamDefaultSinkWriteAlgorithm(stream, chunk);
  };
  const closeAlgorithm = function () {
    return transformStreamDefaultSinkCloseAlgorithm(stream);
  };
  const abortAlgorithm = function (reason) {
    return transformStreamDefaultSinkAbortAlgorithm(stream, reason);
  };
  const pullAlgorithm = function () {
    return transformStreamDefaultSourcePullAlgorithm(stream);
  };
  const sourceCancelAlgorithm = function (reason) {
    return transformStreamDefaultSourceCancelAlgorithm(stream, reason);
  };
  stream[kWritable] = createWritableStream(
      startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm,
      writableHighWaterMark, writableSizeAlgorithm);
  stream[kReadable] = createReadableStream(
      startAlgorithm, pullAlgorithm, sourceCancelAlgorithm,
      readableHighWaterMark, readableSizeAlgorithm);
  transformStreamSetBackpressure(stream, true);
  stream[kController] = undefined;

  // SetUpTransformStreamDefaultControllerFromTransformer.
  const controller = Object.create(TransformStreamDefaultController.prototype);
  controller[kStream] = stream;
  stream[kController] = controller;
  controller[kFinishPromise] = undefined;

  // The WebIDL callbacks (transform/flush/cancel) return promises; a
  // thrown exception is converted to a rejected promise, and a returned
  // promise/thenable is adopted (through a new promise, per the WebIDL
  // callback conversion), which matters for microtask ordering.
  var transformAlgorithm = function (chunk) {
    try {
      transformStreamDefaultControllerEnqueue(controller, chunk);
      return Promise.resolve(undefined);
    } catch (e) {
      return Promise.reject(e);
    }
  };
  var flushAlgorithm = function () {
    return Promise.resolve(undefined);
  };
  var cancelAlgorithm = function () {
    return Promise.resolve(undefined);
  };
  if (transformFn !== undefined) {
    transformAlgorithm = function (chunk) {
      try {
        return new Promise(function (resolve) {
          resolve(transformFn(chunk, controller));
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  if (flushFn !== undefined) {
    flushAlgorithm = function () {
      try {
        return new Promise(function (resolve) {
          resolve(flushFn(controller));
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  if (cancelFn !== undefined) {
    cancelAlgorithm = function (reason) {
      try {
        return new Promise(function (resolve) {
          resolve(cancelFn(reason));
        });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
  controller[kTransformAlgorithm] = transformAlgorithm;
  controller[kFlushAlgorithm] = flushAlgorithm;
  controller[kCancelAlgorithm] = cancelAlgorithm;

  // Resolve the start promise with the result of invoking the
  // transformer's start method. A thrown exception is re-thrown by the
  // constructor.
  if (startFn !== undefined) {
    startPromiseHolder.resolve(startFn(controller));
  } else {
    startPromiseHolder.resolve(undefined);
  }
}

Object.defineProperty(TransformStream.prototype, "readable", {
  get: function () {
    return this[kReadable];
  },
  enumerable: false,
  configurable: true,
});

Object.defineProperty(TransformStream.prototype, "writable", {
  get: function () {
    return this[kWritable];
  },
  enumerable: false,
  configurable: true,
});

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
exports.WritableStream = WritableStream;
exports.WritableStreamDefaultWriter = WritableStreamDefaultWriter;
exports.WritableStreamDefaultController = WritableStreamDefaultController;
exports.TransformStream = TransformStream;
exports.TransformStreamDefaultController = TransformStreamDefaultController;
exports.CountQueuingStrategy = CountQueuingStrategy;
exports.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
