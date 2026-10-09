package org.brail.what4j.core;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;

public class URLModule {
  public static void load(Context cx, VarScope scope) {
    try {
      Utils.loadModuleResource(cx, scope, URLModule.class, "core/scripts/url.js");
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }
}
