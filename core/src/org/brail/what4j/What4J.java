package org.brail.what4j;

import org.brail.what4j.core.BindingsLoader;
import org.brail.what4j.core.EncodingModule;
import org.brail.what4j.core.LoadableModule;
import org.brail.what4j.core.PerformanceModule;
import org.brail.what4j.core.StreamsModule;
import org.brail.what4j.core.URLModule;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * This is the main loader for the system. It loads the requested modules into the specified scope.
 */
public class What4J {
  private static final Map<String, LoadableModule> MODULES;

  private final LoadContext lc;

  static {
    MODULES = new HashMap<>();
    MODULES.put("Encoding", EncodingModule::load);
    MODULES.put("Performance", PerformanceModule::load);
    MODULES.put("Streams", StreamsModule::load);
    MODULES.put("URL", URLModule::load);
  }

  public What4J(Context cx, VarScope scope) {
    var loader = new BindingsLoader();
    var getBindings = loader.makeGetBindings(cx, scope);
    lc = () -> getBindings;
  }

  public void load(Context cx, VarScope scope, String moduleName) {
    var loader = MODULES.get(moduleName);
    if (loader == null) {
      throw new IllegalArgumentException("Unknown module: " + moduleName);
    }
    try {
      loader.load(cx, scope, lc);
    } catch (IOException e) {
      throw new IllegalArgumentException("Failed to load module: " + moduleName, e);
    }
  }
}
