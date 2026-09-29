package org.brail.what4j.testrunner;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

public class TestUtils extends ScriptableObject {
  public static void init(Context cx, VarScope scope) {
    var to = cx.newObject(scope);
    ScriptableObject.defineProperty(
        to, "gc", new LambdaFunction(scope, "gc", 0, TestUtils::gc), DONTENUM);
    ScriptableObject.defineProperty(scope, "TestUtils", to, DONTENUM);
  }

  private static Object gc(Context cx, VarScope s, Object to, Object[] args) {
    System.gc();
    return Undefined.instance;
  }

  @Override
  public String getClassName() {
    return "TestUtils";
  }
}
