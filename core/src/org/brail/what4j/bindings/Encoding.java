package org.brail.what4j.bindings;

import org.brail.what4j.bindings.encoding.Decoder;
import org.brail.what4j.bindings.encoding.UnsupportedDecoder;
import org.brail.what4j.bindings.encoding.Utf16Decoder;
import org.brail.what4j.bindings.encoding.Utf8Decoder;
import org.brail.what4j.bindings.encoding.XUserDefinedDecoder;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;
import org.mozilla.javascript.typedarrays.NativeArrayBuffer;

import java.io.ByteArrayOutputStream;
import java.util.Locale;

public class Encoding {
  public static Scriptable init(Context cx, VarScope scope) {
    var o = cx.newObject(scope);
    o.put("utf8Encode", o, new LambdaFunction(scope, "utf8Encode", 1, Encoding::utf8Encode));
    o.put("utf8Decode", o, new LambdaFunction(scope, "utf8Decode", 1, Encoding::utf8Decode));
    o.put("newDecoder", o, new LambdaFunction(scope, "newDecoder", 3, Encoding::newDecoder));
    return o;
  }

  private static Object utf8Encode(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    byte[] bytes = utf8EncodeBytes(ScriptRuntime.toString(args[0]));
    var ab = cx.newObject(scope, "ArrayBuffer", new Object[] {bytes.length});
    var result = cx.newObject(scope, "Uint8Array", new Object[] {ab});
    var buffer = ((NativeArrayBuffer) ab).getByteBuffer();
    buffer.rewind();
    buffer.put(bytes);
    buffer.rewind();
    return result;
  }

  private static Object utf8Decode(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    return new Utf8Decoder(false, false, false).decode(args[0], false);
  }

  private static Object newDecoder(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 3) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    String name = ScriptRuntime.toString(args[0]);
    boolean fatal = ScriptRuntime.toBoolean(args[1]);
    boolean ignoreBom = ScriptRuntime.toBoolean(args[2]);
    Decoder decoder = createDecoder(name, fatal, ignoreBom);
    var o = cx.newObject(scope);
    o.put(
        "decode",
        o,
        new LambdaFunction(
            scope,
            "decode",
            2,
            (Context cx2, VarScope scope2, Object self2, Object[] args2) -> {
              Object input = args2.length > 0 ? args2[0] : Undefined.instance;
              boolean doNotFlush = args2.length > 1 && Context.toBoolean(args2[1]);
              return decoder.decode(input, doNotFlush);
            }));
    return o;
  }

  static Decoder createDecoder(String name, boolean fatal, boolean ignoreBom) {
    var normalized = name.toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "utf-8" -> new Utf8Decoder(fatal, ignoreBom, true);
      case "utf-16be" -> new Utf16Decoder(true, fatal, ignoreBom, true);
      case "utf-16le" -> new Utf16Decoder(false, fatal, ignoreBom, true);
      case "x-user-defined" -> new XUserDefinedDecoder();
      default -> new UnsupportedDecoder(name, fatal, ignoreBom);
    };
  }

  /** The spec's "UTF-8 encode" (unpaired surrogates become U+FFFD). */
  public static byte[] utf8EncodeBytes(String str) {
    var out = new ByteArrayOutputStream();
    int i = 0;
    while (i < str.length()) {
      int c = str.charAt(i);
      int cp;
      int step = 1;
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length()) {
        int next = str.charAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          cp = 0x10000 + ((c - 0xD800) << 10) + (next - 0xDC00);
          step = 2;
        } else {
          cp = 0xFFFD;
        }
      } else if (c >= 0xD800 && c <= 0xDFFF) {
        cp = 0xFFFD;
      } else {
        cp = c;
      }
      i += step;
      appendUtf8(out, cp);
    }
    return out.toByteArray();
  }

  static void appendUtf8(ByteArrayOutputStream out, int cp) {
    if (cp < 0x80) {
      out.write(cp);
    } else if (cp < 0x800) {
      out.write(0xC0 | (cp >> 6));
      out.write(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out.write(0xE0 | (cp >> 12));
      out.write(0x80 | ((cp >> 6) & 0x3F));
      out.write(0x80 | (cp & 0x3F));
    } else {
      out.write(0xF0 | (cp >> 18));
      out.write(0x80 | ((cp >> 12) & 0x3F));
      out.write(0x80 | ((cp >> 6) & 0x3F));
      out.write(0x80 | (cp & 0x3F));
    }
  }
}
