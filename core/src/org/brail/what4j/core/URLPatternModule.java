package org.brail.what4j.core;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;

public class URLPatternModule {
  public static void load(Context cx, VarScope scope) {
    URLModule.load(cx, scope);
    try {
      Utils.loadModuleResource(cx, scope, URLPatternModule.class, "core/scripts/urlpattern.js");
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }
}
