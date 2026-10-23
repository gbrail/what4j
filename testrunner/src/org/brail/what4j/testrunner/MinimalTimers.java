package org.brail.what4j.testrunner;

import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

import java.util.Arrays;
import java.util.HashMap;
import java.util.PriorityQueue;
import java.util.Queue;

/**
 * Implement setTimeout and clearTimeout for the test harness, using real wall-clock deadlines on a
 * single-threaded queue of timers.
 *
 * <p>Timer IDs are positive integers, as in browsers: no timer can have ID 0, so the {@code
 * clearTimeout(null)} and {@code clearTimeout(undefined)} calls that testharness.js makes when a
 * test without a "timeout" property completes (both convert to 0) are safe no-ops.
 */
public class MinimalTimers {
  private final HashMap<Integer, Timer> timers = new HashMap<>();
  private final Queue<Timer> pending = new PriorityQueue<>();
  private int nextId = 1;

  private static final class Timer implements Comparable<Timer> {
    final int id;
    final long deadline;
    final Callable callback;
    final Object[] args;
    boolean cancelled;

    Timer(int id, long deadline, Callable callback, Object[] args) {
      this.id = id;
      this.deadline = deadline;
      this.callback = callback;
      this.args = args;
    }

    @Override
    public int compareTo(Timer other) {
      return Long.compare(deadline, other.deadline);
    }
  }

  /**
   * Register the "setTimeout" and "clearTimeout" functions in the specified scope for the current
   * context.
   */
  public void init(VarScope scope) {
    ScriptableObject.defineProperty(
        scope,
        "setTimeout",
        new LambdaFunction(scope, "setTimeout", 2, this::setTimeout),
        ScriptableObject.DONTENUM);
    ScriptableObject.defineProperty(
        scope,
        "clearTimeout",
        new LambdaFunction(scope, "clearTimeout", 1, this::clearTimeout),
        ScriptableObject.DONTENUM);
  }

  /**
   * Fire the next pending timer, sleeping until its deadline if it has not expired yet. Cancelled
   * timers are discarded without firing.
   *
   * <p>The caller is expected to process microtasks after each call so that each timer gets its own
   * event-loop turn, as in a browser.
   *
   * @return false if there are no pending timers, true if a timer was fired
   */
  public boolean run(Context cx, VarScope scope) {
    while (true) {
      Timer head = pending.peek();
      if (head == null) {
        return false;
      }
      if (head.cancelled) {
        pending.remove();
        timers.remove(head.id);
        continue;
      }
      long now = System.currentTimeMillis();
      if (head.deadline > now) {
        sleepUntil(head.deadline);
        continue;
      }
      pending.remove();
      timers.remove(head.id);
      // Per the HTML spec, timer callbacks run with this value set to the global
      // object, so even strict-mode functions observe this === globalThis.
      var global = ScriptableObject.getTopLevelScope(scope).getGlobalThis();
      head.callback.call(cx, scope, global, head.args);
      return true;
    }
  }

  private Object setTimeout(Context cx, VarScope scope, Object thisObj, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("setTimeout requires a handler argument");
    }
    // The delay is optional and defaults to 0.
    long timeout = 0;
    int argOffset = 1;
    if (args.length >= 2) {
      timeout = (long) ScriptRuntime.toNumber(args[1]);
      argOffset = 2;
    }
    if (timeout < 0) {
      timeout = 0;
    }
    if (timeout > Integer.MAX_VALUE) {
      timeout = Integer.MAX_VALUE;
    }
    Object[] timerArgs =
        args.length > argOffset
            ? Arrays.copyOfRange(args, argOffset, args.length)
            : ScriptRuntime.emptyArgs;
    Callable callback;
    if (args[0] instanceof Callable function) {
      callback = function;
    } else {
      // Per the HTML spec, a non-function handler is stringified and compiled and
      // run as a classic script when the timer fires.
      String code = Context.toString(args[0]);
      callback = (c, s, t, a) -> c.evaluateString(s, code, "setTimeout", 1, null);
    }
    int id = nextId++;
    var timer = new Timer(id, System.currentTimeMillis() + timeout, callback, timerArgs);
    timers.put(id, timer);
    pending.add(timer);
    return id;
  }

  private Object clearTimeout(Context cx, VarScope scope, Object thisObj, Object[] args) {
    // The ID argument is optional and defaults to 0; since no timer can have ID 0,
    // clearTimeout(), clearTimeout(null), and clearTimeout(undefined) are no-ops.
    if (args.length >= 1) {
      var t = timers.get(ScriptRuntime.toInt32(args[0]));
      if (t != null) {
        t.cancelled = true;
      }
    }
    return Undefined.instance;
  }

  private static void sleepUntil(long deadline) {
    long millis = deadline - System.currentTimeMillis();
    if (millis <= 0) {
      return;
    }
    try {
      Thread.sleep(millis);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
