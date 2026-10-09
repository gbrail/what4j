package org.brail.what4j.testrunner;

import java.io.IOException;
import java.nio.file.Path;
import java.util.regex.Pattern;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

public class HelperLoader {
  private static final Pattern SCRIPT_INSTRUCTION = Pattern.compile("//\\s*META:\\s*script=(.*)");

  /**
   * Find directives of the form "META: script=xxx" in the input script, and loads the named script.
   */
  public static void loadHelpers(Context cx, VarScope scope, String script, Path parentPath) {
    var m = SCRIPT_INSTRUCTION.matcher(script);
    while (m.find()) {
      var scriptName = m.group(1).trim();
      String loadPathStr;
      if (scriptName.startsWith("/")) {
        loadPathStr = "wpt" + scriptName;
      } else {
        loadPathStr = parentPath.resolve(scriptName).toString();
      }
      try {
        String helperSource = Utils.readFile(loadPathStr);
        loadHelpers(cx, scope, helperSource, Path.of(loadPathStr).getParent());
        cx.evaluateString(scope, helperSource, scriptName, 1, null);
      } catch (IOException ioe) {
        throw new AssertionError("Can't load file " + loadPathStr + ": " + ioe, ioe);
      }
    }
  }
}
