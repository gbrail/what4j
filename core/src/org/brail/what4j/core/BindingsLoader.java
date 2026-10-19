package org.brail.what4j.core;

import org.brail.what4j.bindings.Encoding;
import org.brail.what4j.bindings.ICU;
import org.brail.what4j.bindings.Performance;
import org.brail.what4j.bindings.Url;
import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.VarScope;

import java.util.HashMap;
import java.util.Map;
import java.util.function.BiFunction;

public class BindingsLoader {
  private static final Map<String, BiFunction<Context, VarScope, Scriptable>> BINDINGS;

  private final HashMap<String, Scriptable> bindingsCache = new HashMap<>();

  static {
    BINDINGS = new HashMap<>();
    BINDINGS.put("ICU", ICU::init);
    BINDINGS.put("encoding", Encoding::init);
    BINDINGS.put("performance", Performance::init);
    BINDINGS.put("url", Url::init);
  }

  /** Return the function that is passed as "getBindings" in the module's script scope. */
  public Callable makeGetBindings(Context cx, VarScope scope) {
    return new LambdaFunction(scope, "getBindings", 1, this::getBindingsImpl);
  }

  private Object getBindingsImpl(Context cx, VarScope scope, Object to, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough argument");
    }
    String name = Context.toString(args[0]);
    return bindingsCache.computeIfAbsent(
        name,
        (k) -> {
          var loader = BINDINGS.get(k);
          if (loader == null) {
            throw ScriptRuntime.constructError("Error", "Unknown binding " + k);
          }
          return loader.apply(cx, scope);
        });
  }
}
