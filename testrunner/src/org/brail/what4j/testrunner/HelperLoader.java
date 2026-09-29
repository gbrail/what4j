package org.brail.what4j.testrunner;

import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.regex.Pattern;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.VarScope;

public class HelperLoader {
  private static final Pattern SCRIPT_INSTRUCTION = Pattern.compile("//\\s*META:\\s*script=(.*)");

  /**
   * Find directives of the form "META: script=xxx" in the input script, and loads the named script.
   */
  public static void loadHelpers(Context cx, VarScope scope, String script, Path parentPath) {
    var m = SCRIPT_INSTRUCTION.matcher(script);
    while (m.find()) {
      var scriptName = m.group(1);
      Path loadPath;
      if (scriptName.startsWith("/")) {
        loadPath = Path.of(WPTTestLauncher.TEST_BASE, scriptName);
      } else {
        loadPath = parentPath.resolve(scriptName);
      }
      try (var w = new FileReader(loadPath.toFile(), StandardCharsets.UTF_8)) {
        cx.evaluateReader(scope, w, scriptName, 1, null);
      } catch (IOException ioe) {
        throw new AssertionError("Can't load file " + loadPath + ": " + ioe, ioe);
      }
    }
  }
}
