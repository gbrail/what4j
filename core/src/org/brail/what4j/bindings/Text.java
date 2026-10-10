package org.brail.what4j.bindings;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.ExternalArrayData;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;
import org.mozilla.javascript.typedarrays.NativeArrayBuffer;
import org.mozilla.javascript.typedarrays.NativeArrayBufferView;

import java.nio.charset.StandardCharsets;

/**
 * Bindings for String encoding and decoding.
 */
public class Text {
  public static Scriptable init(Context cx, VarScope scope) {
    var o = cx.newObject(scope);
    o.put("utf8Encode", o, new LambdaFunction(scope, "utf8Encode", 1, Text::utf8Encode));
    o.put("utf8Decode", o, new LambdaFunction(scope, "utf8Decode", 1, Text::utf8Decode));
    return o;
  }

  /**
   * Encode a string to an array of bytes. The array will be backed by the
   * []byte until we get some capability in Rhino to create a Uint8Array.
   */
  private static Object utf8Encode(Context cx, VarScope s, Object to, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    String str = Context.toString(args[0]);
    byte[] bytes = str.getBytes(StandardCharsets.UTF_8);
    var ab = cx.newObject(s, "ArrayBuffer", new Object[]{bytes.length});
    var a = cx.newObject(s, "Uint8Array", new Object[]{ab});
    var ra = ((NativeArrayBuffer)ab).getByteBuffer();
    ra.rewind();
    ra.put(bytes);
    ra.rewind();
    return a;
  }

  private static Object utf8Decode(Context cx, VarScope s, Object to, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    if (args[0] instanceof NativeArrayBufferView bav) {
      var ra = bav.getBuffer().getByteBuffer();
      byte[] bytes = new byte[ra.limit()];
      ra.rewind();
      ra.get(bytes);
      ra.rewind();
      return new String(bytes, StandardCharsets.UTF_8);
    } else if (args[0] instanceof NativeArray a) {
      byte[] buf = new byte[(int)a.getLength()];
      for (int i = 0; i < buf.length; i++) {
        buf[i] = (byte)(ScriptRuntime.toInt32(a.get(i)) & 0xff);
      }
      return new String(buf, StandardCharsets.UTF_8);
    }
    throw ScriptRuntime.typeError("Only arrays are supported");
  }
}
