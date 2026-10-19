package org.brail.what4j.core;

import org.brail.what4j.LoadContext;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;
import java.util.List;

/**
 * This module loads:
 *
 * <ul>
 *   <li>Performance (High Resolution Time: performance object, minimal Event)
 * </ul>
 */
public class PerformanceModule {
  public static void load(Context cx, VarScope scope, LoadContext lc) {
    try {
      Utils.loadModuleResources(
          cx, scope, lc, PerformanceModule.class, List.of("core/scripts/performance.js"));
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }
}
