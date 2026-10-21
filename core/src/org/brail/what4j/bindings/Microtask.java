package org.brail.what4j.bindings;

import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

/**
 * Bindings for the platform's microtask queue: {@code queueMicrotask}, which enqueues a job to run
 * at the next microtask checkpoint.
 *
 * <p>The job is enqueued directly on the engine's microtask queue via {@link
 * Context#enqueueMicrotask}, the same queue the engine's Promise implementation schedules its
 * {@code then} reactions on (see {@code NativePromise}). Scheduling through it directly, rather
 * than via {@code Promise.resolve().then(...)}, keeps the calling module's pure-JS code independent
 * of the Promise machinery while preserving the same FIFO ordering.
 */
public class Microtask {
  public static Scriptable init(Context cx, VarScope scope) {
    var o = cx.newObject(scope);
    o.put("queueMicrotask", o, new LambdaFunction(scope, "queueMicrotask", 1, Microtask::queue));
    return o;
  }

  private static Object queue(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("queueMicrotask requires a callback argument");
    }
    var callback = (Callable) args[0];
    cx.enqueueMicrotask(() -> callback.call(cx, scope, null, ScriptRuntime.emptyArgs));
    return Undefined.instance;
  }
}
