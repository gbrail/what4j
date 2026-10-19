package org.brail.what4j.bindings.url;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

/** String helpers shared by the URL and URLPattern modules. */
public final class Strings {
  private Strings() {}

  /** The spec's "the code points of" — returns a JS array of code point values. */
  public static Object codePoints(Context cx, VarScope scope, String str) {
    int[] cps = str.codePoints().toArray();
    Object[] arr = new Object[cps.length];
    for (int i = 0; i < cps.length; i++) {
      arr[i] = (double) cps[i];
    }
    return cx.newArray(scope, arr);
  }

  /** The spec's "convert to USVString". */
  public static String toUSVString(String str) {
    StringBuilder out = new StringBuilder(str.length());
    int i = 0;
    while (i < str.length()) {
      int c = str.charAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        if (i + 1 < str.length()) {
          int next = str.charAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            out.append((char) c).append((char) next);
            i += 2;
            continue;
          }
        }
        out.append('\uFFFD');
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        out.append('\uFFFD');
      } else {
        out.append((char) c);
      }
      i++;
    }
    return out.toString();
  }
}
