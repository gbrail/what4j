package org.brail.what4j.testrunner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

public class MinimalFetch {
  public static void init(Context cx, VarScope scope) throws IOException {
    var loadFunc = new LambdaFunction(scope, "load", 1, MinimalFetch::load);
    String miniFetch = Utils.readFile("testrunner/scripts/mini-fetch.js");
    var exports = (Scriptable) cx.evaluateString(scope, miniFetch, "mini-fetch.js", 1, null);
    var loadFetch = (Function) exports.get("loadFetch", exports);
    var fetchFunc = (Function) loadFetch.call(cx, scope, null, new Object[] {loadFunc});
    ScriptableObject.defineProperty(scope, "fetch", fetchFunc, ScriptableObject.DONTENUM);
    var setBaseFunc = (Function) exports.get("setBase", exports);
    ScriptableObject.defineProperty(
        scope, "__setFetchBase", setBaseFunc, ScriptableObject.DONTENUM);
  }

  private static Object load(Context cx, VarScope scope, Object thisObj, Object[] args) {
    if (args.length > 0) {
      String path = ScriptRuntime.toString(args[0]);
      // TODO check for absolute path?
      if (args.length > 1 && !Undefined.isUndefined(args[1])) {
        String base = ScriptRuntime.toString(args[1]);
        path = base + '/' + path;
      }
      try {
        return Utils.readFile(path);
      } catch (IOException ioe) {
        throw ScriptRuntime.constructError("Error", ioe.toString());
      }
    }
    return Undefined.instance;
  }
}
