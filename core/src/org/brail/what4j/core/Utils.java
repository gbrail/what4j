package org.brail.what4j.core;

import org.mozilla.javascript.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

public class Utils {
  /**
   * Load a module from JavaScript as follows:
   *
   * <p>1. Read the resource from the classpath. 2. Evaluate the script, which should return a
   * function 3. Call the function, passing an exports object 4. Copy values from the exports object
   * to the provided scope
   */
  public static void loadModuleResource(Context cx, VarScope scope, Class<?> base, String path)
      throws IOException {
    var fileName = Path.of(path).getFileName().toString();
    Callable result;
    try (var rdr = readResource(base, path)) {
      var r = cx.evaluateReader(scope, rdr, fileName, 1, null);
      if (!(r instanceof Callable c)) {
        throw new IOException("Expected script to return a function: " + path);
      }
      result = c;
    }

    var exports = cx.newObject(scope);
    result.call(cx, scope, Undefined.instance, new Object[] {exports});
    for (var key : exports.getIds()) {
      if (key instanceof String ks) {
        scope.put(ks, scope, exports.get(ks, exports));
      }
    }
  }

  private static Reader readResource(Class<?> base, String path) throws IOException {
    InputStream in = base.getClassLoader().getResourceAsStream(path);
    if (in == null) {
      throw new IOException("Could not find " + path);
    }
    return new InputStreamReader(in, StandardCharsets.UTF_8);
  }
}
