package org.brail.what4j.bindings.url;

import org.brail.what4j.bindings.Encoding;
import org.brail.what4j.bindings.encoding.Utf8Decoder;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.VarScope;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * WHATWG percent-encoding and the application/x-www-form-urlencoded parser/serializer.
 *
 * <p>UTF-8 conversion reuses the Encoding binding's machinery: {@link Encoding#utf8EncodeBytes} for
 * the spec's "percent-encode after encoding" step (it replaces unpaired surrogates with U+FFFD, as
 * the spec requires), and the WHATWG-conformant {@link Utf8Decoder} for bytes-to-string (no BOM
 * handling, matching the URL standard's raw UTF-8 decode).
 */
public final class Percent {
  private static final String HEX = "0123456789ABCDEF";

  // The percent-encode sets, each built from its spec predecessor.
  static final boolean[] C0_CONTROL = c0ControlSet();
  static final boolean[] FRAGMENT = set(C0_CONTROL, 0x20, 0x22, 0x3C, 0x3E, 0x60);
  static final boolean[] QUERY = set(C0_CONTROL, 0x20, 0x22, 0x23, 0x3C, 0x3E);
  static final boolean[] SPECIAL_QUERY = set(QUERY, 0x27);
  static final boolean[] PATH = set(QUERY, 0x3F, 0x5E, 0x60, 0x7B, 0x7D);
  static final boolean[] USERINFO = set(PATH, 0x2F, 0x3A, 0x3B, 0x3D, 0x40, 0x5B, 0x5C, 0x5D, 0x7C);
  private static final boolean[] COMPONENT = set(USERINFO, 0x24, 0x25, 0x26, 0x2B, 0x2C);
  private static final boolean[] FORM_URL_ENCODED = set(COMPONENT, 0x21, 0x27, 0x28, 0x29, 0x7E);

  private Percent() {}

  /** "Percent-encode after encoding" with the named set. */
  public static String percentEncode(String input, String setName) {
    return percentEncode(input, setForName(setName), false);
  }

  static String percentEncode(String input, boolean[] set, boolean spaceAsPlus) {
    byte[] bytes = Encoding.utf8EncodeBytes(input);
    StringBuilder out = new StringBuilder(bytes.length * 2);
    for (byte raw : bytes) {
      int b = raw & 0xFF;
      if (spaceAsPlus && b == 0x20) {
        out.append('+');
      } else if (b < 0x80 && !set[b]) {
        out.append((char) b);
      } else {
        out.append('%').append(HEX.charAt(b >> 4)).append(HEX.charAt(b & 0xF));
      }
    }
    return out.toString();
  }

  private static boolean[] setForName(String name) {
    return switch (name) {
      case "c0-control" -> C0_CONTROL;
      case "fragment" -> FRAGMENT;
      case "query" -> QUERY;
      case "special-query" -> SPECIAL_QUERY;
      case "path" -> PATH;
      case "userinfo" -> USERINFO;
      default -> throw ScriptRuntime.constructError("Error", "Unknown percent-encode set " + name);
    };
  }

  private static boolean[] c0ControlSet() {
    boolean[] s = new boolean[256];
    for (int i = 0x00; i <= 0x1F; i++) {
      s[i] = true;
    }
    s[0x7F] = true;
    return s;
  }

  private static boolean[] set(boolean[] base, int... extra) {
    boolean[] s = base.clone();
    for (int b : extra) {
      s[b] = true;
    }
    return s;
  }

  /** "Percent-decode" then raw UTF-8 decode (no BOM handling). */
  static String percentDecodeString(String input) {
    byte[] bytes = percentDecodeBytes(Encoding.utf8EncodeBytes(input));
    return new Utf8Decoder(false, false, false).decodeBytes(bytes);
  }

  static byte[] percentDecodeBytes(byte[] bytes) {
    byte[] out = new byte[bytes.length];
    int n = 0;
    for (int i = 0; i < bytes.length; i++) {
      int b = bytes[i] & 0xFF;
      if (b != 0x25) {
        out[n++] = bytes[i];
        continue;
      }
      int b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xFF : -1;
      int b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xFF : -1;
      if (b1 == -1 || b2 == -1 || !isASCIIHexDigit(b1) || !isASCIIHexDigit(b2)) {
        out[n++] = bytes[i];
        continue;
      }
      out[n++] = (byte) (hexValue(b1) * 16 + hexValue(b2));
      i += 2;
    }
    return Arrays.copyOf(out, n);
  }

  // Shared ASCII predicates (also used by Hosts).

  static boolean isASCIIDigit(int cp) {
    return cp >= 0x30 && cp <= 0x39;
  }

  static boolean isASCIIHexDigit(int cp) {
    return isASCIIDigit(cp) || (cp >= 0x41 && cp <= 0x46) || (cp >= 0x61 && cp <= 0x66);
  }

  static int hexValue(int cp) {
    if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
    if (cp >= 0x61 && cp <= 0x66) return cp - 0x61 + 10;
    if (cp >= 0x41 && cp <= 0x46) return cp - 0x41 + 10;
    return 0;
  }

  // ---------------------------------------------------------------------------
  // application/x-www-form-urlencoded
  // ---------------------------------------------------------------------------

  /** "Urlencoded string parser" — returns a JS array of [name, value] pairs. */
  public static Object urlencodedParse(Context cx, VarScope scope, String input) {
    byte[] bytes = Encoding.utf8EncodeBytes(input);
    List<String[]> pairs = new ArrayList<>();
    int start = 0;
    for (int i = 0; i <= bytes.length; i++) {
      if (i < bytes.length && bytes[i] != 0x26) continue;
      if (i > start) {
        int eq = -1;
        for (int j = start; j < i; j++) {
          if (bytes[j] == 0x3D) {
            eq = j;
            break;
          }
        }
        int nameEnd = eq == -1 ? i : eq;
        int valueStart = eq == -1 ? i : eq + 1;
        pairs.add(
            new String[] {
              decodeSegment(bytes, start, nameEnd), decodeSegment(bytes, valueStart, i)
            });
      }
      start = i + 1;
    }
    Object[] arr = new Object[pairs.size()];
    for (int i = 0; i < pairs.size(); i++) {
      arr[i] = cx.newArray(scope, new Object[] {pairs.get(i)[0], pairs.get(i)[1]});
    }
    return cx.newArray(scope, arr);
  }

  private static String decodeSegment(byte[] bytes, int from, int to) {
    byte[] seg = new byte[to - from];
    for (int i = from; i < to; i++) {
      seg[i - from] = bytes[i] == 0x2B ? (byte) 0x20 : bytes[i];
    }
    return new Utf8Decoder(false, false, false).decodeBytes(percentDecodeBytes(seg));
  }

  /** "Urlencoded serializer" — takes a JS array of [name, value] pairs. */
  public static String urlencodedSerialize(Object list) {
    NativeArray arr = (NativeArray) list;
    StringBuilder out = new StringBuilder();
    long length = arr.getLength();
    for (int i = 0; i < length; i++) {
      NativeArray pair = (NativeArray) arr.get(i);
      String name = Context.toString(pair.get(0));
      String value = Context.toString(pair.get(1));
      if (i > 0) out.append('&');
      out.append(percentEncode(name, FORM_URL_ENCODED, true))
          .append('=')
          .append(percentEncode(value, FORM_URL_ENCODED, true));
    }
    return out.toString();
  }
}
