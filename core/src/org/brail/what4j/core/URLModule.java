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
 *   <li>URL
 *   <li>URLSearchParams
 *   <li>URLPattern
 * </ul>
 */
public class URLModule {
  public static void load(Context cx, VarScope scope, LoadContext lc) {
    try {
      Utils.loadModuleResources(
          cx,
          scope,
          lc,
          URLModule.class,
          List.of("core/scripts/url.js", "core/scripts/urlpattern.js"));
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }
}
