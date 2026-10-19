package org.brail.what4j.bindings;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.VarScope;

/**
 * Bindings for the High Resolution Time standard's Performance interface: a monotonic
 * high-resolution clock ({@code System.nanoTime}) coarsened to the resolution the spec mandates,
 * and the epoch-relative time origin.
 *
 * <p>Per the spec's "coarsen time" algorithm, the exposed clock must not have a resolution finer
 * than 100 microseconds (5 microseconds for cross-origin isolated contexts, which this
 * implementation does not model). Coarsening is a floor onto the resolution grid; it is monotonic,
 * so {@code now()} values are never decreasing.
 */
public class Performance {
  /** "Coarsen time" resolution: 100 microseconds. */
  private static final long RESOLUTION_NS = 100_000;

  public static Scriptable init(Context cx, VarScope scope) {
    // The time origin is a moment early in the initialization of this context. The
    // "estimated monotonic time of the Unix epoch" maps the monotonic clock onto
    // wall-clock milliseconds at that moment, so that timeOrigin is an
    // epoch-relative timestamp (spec §4).
    long originWallMs = System.currentTimeMillis();
    long originMonoNs = System.nanoTime();
    long epochOffsetNs = coarsen(originMonoNs - originWallMs * 1_000_000L);
    long originNs = coarsen(originMonoNs);

    var o = cx.newObject(scope);
    o.put(
        "now",
        o,
        new LambdaFunction(
            scope,
            "now",
            0,
            (c, s, sl, a) -> (coarsen(System.nanoTime()) - originNs) / 1_000_000.0));
    o.put("timeOrigin", o, (originNs - epochOffsetNs) / 1_000_000.0);
    return o;
  }

  private static long coarsen(long ns) {
    return ns / RESOLUTION_NS * RESOLUTION_NS;
  }
}
