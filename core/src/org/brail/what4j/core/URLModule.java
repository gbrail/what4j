package org.brail.what4j.core;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

import java.io.IOException;
import java.util.List;

/**
 * This module loads:
 *
 * <ul>
 *   <li>URL</li>
 *   <li>URLSearchParams</li>
 *   <li>URLPattern</li>
 * </ul>
 */
public class URLModule {
  public static void load(Context cx, VarScope scope) {
    var idna = cx.newObject(scope);
    ScriptableObject.defineProperty(
        idna,
        "toASCII",
        new LambdaFunction(scope, "toASCII", 2, URLModule::toASCII),
        ScriptableObject.DONTENUM);
    scope.put("__urlIdna", scope, idna);
    try {
      Utils.loadModuleResources(
          cx, scope, URLModule.class, List.of("core/scripts/url.js", "core/scripts/urlpattern.js"));
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }

  private static Object toASCII(Context cx, VarScope scope, Object self, Object[] args) {
    String domain = Context.toString(args[0]);
    boolean beStrict = Context.toBoolean(args[1]);
    String result = IdnaBridge.toASCII(domain, beStrict);
    return result == null ? Undefined.instance : result;
  }
}
