package org.brail.what4j.core;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

import java.io.IOException;

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
      Utils.loadModuleResource(cx, scope, URLModule.class, "core/scripts/url.js");
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
