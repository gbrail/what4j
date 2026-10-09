package org.brail.what4j.core;

import org.mozilla.javascript.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;

public class Utils {
  /**
   * Load a list of modules from JavaScript. All the modules will be loaded in the same scope, which
   * will be a child of the provided (presumably global) scope. The special object "exports" will be
   * set in this scope, and any string properties assigned to "exports" will be copied back to the
   * original outer scope once the code runs. This way, each module and its friends shares a scope
   * for variables that are private to itself or to its friends without polluting the global scope.
   *
   * <ol>
   *   <li>Create a new context
   *   <li>Populate it with an "exports" object
   *   <li>Run the specified scripts in the context
   *   <li>Copy everything on "exports" to the global scope
   * </ol>
   */
  public static void loadModuleResources(
      Context cx, VarScope scope, Class<?> base, List<String> paths) throws IOException {
    var exports = cx.newObject(scope);
    var loadScope = new LocalScope(scope);
    loadScope.put("exports", loadScope, exports);

    for (var path : paths) {
      var fileName = Path.of(path).getFileName().toString();
      try (var rdr = openResource(base, path)) {
        cx.evaluateReader(loadScope, rdr, fileName, 1, null);
      }
    }

    for (var key : exports.getIds()) {
      if (key instanceof String ks) {
        scope.put(ks, scope, exports.get(ks, exports));
      }
    }
  }

  private static Reader openResource(Class<?> base, String path) throws IOException {
    InputStream in = base.getClassLoader().getResourceAsStream(path);
    if (in == null) {
      throw new IOException("Could not find " + path);
    }
    return new InputStreamReader(in, StandardCharsets.UTF_8);
  }
}
