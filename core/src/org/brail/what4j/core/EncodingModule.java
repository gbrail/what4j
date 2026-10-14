package org.brail.what4j.core;

import org.brail.what4j.LoadContext;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;
import java.util.List;

/** This module loads the WHATWG Encoding API (TextEncoder and TextDecoder). */
public class EncodingModule {
  public static void load(Context cx, VarScope scope, LoadContext lc) {
    try {
      Utils.loadModuleResources(
          cx,
          scope,
          lc,
          EncodingModule.class,
          List.of("core/scripts/encoding-labels.js", "core/scripts/encoding.js"));
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }
}
