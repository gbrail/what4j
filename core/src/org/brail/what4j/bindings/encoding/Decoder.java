package org.brail.what4j.bindings.encoding;

import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.typedarrays.NativeArrayBuffer;
import org.mozilla.javascript.typedarrays.NativeArrayBufferView;

import java.nio.ByteBuffer;

public abstract class Decoder {
  protected final boolean fatal;
  protected final boolean ignoreBom;
  protected final boolean bomRelevant;
  protected boolean bomSeen;

  protected Decoder(boolean fatal, boolean ignoreBom, boolean bomRelevant) {
    this.fatal = fatal;
    this.ignoreBom = ignoreBom;
    this.bomRelevant = bomRelevant;
  }

  public final String decode(Object input, boolean doNotFlush) {
    byte[] bytes = input == null || Undefined.isUndefined(input) ? new byte[0] : copyBytes(input);
    return process(bytes, doNotFlush);
  }

  /** One-shot decode of raw bytes (used by the URL standard's raw UTF-8 decode). */
  public final String decodeBytes(byte[] bytes) {
    return process(bytes, false);
  }

  protected abstract String process(byte[] input, boolean doNotFlush);

  protected void emit(StringBuilder out, int codePoint) {
    if (bomRelevant && !ignoreBom && !bomSeen) {
      bomSeen = true;
      if (codePoint == 0xFEFF) {
        return;
      }
    }
    appendCodePoint(out, codePoint);
  }

  protected void emitError(StringBuilder out) {
    if (fatal) {
      fatalError();
    }
    emit(out, 0xFFFD);
  }

  protected void fatalError() {
    throw ScriptRuntime.typeError("The encoded data is not valid.");
  }

  static void appendCodePoint(StringBuilder out, int codePoint) {
    if (codePoint <= 0xFFFF) {
      out.append((char) codePoint);
      return;
    }
    codePoint -= 0x10000;
    out.append((char) (0xD800 + (codePoint >> 10)));
    out.append((char) (0xDC00 + (codePoint & 0x3FF)));
  }

  static byte[] copyBytes(Object input) {
    if (input instanceof NativeArrayBuffer buffer) {
      ByteBuffer bb = buffer.getByteBuffer();
      if (bb == null) {
        throw ScriptRuntime.typeError("input must be a BufferSource");
      }
      bb.rewind();
      byte[] bytes = new byte[bb.limit()];
      bb.get(bytes);
      return bytes;
    }
    if (input instanceof NativeArrayBufferView view) {
      ByteBuffer bb = view.getBuffer().getByteBuffer();
      if (bb == null) {
        throw ScriptRuntime.typeError("input must be a BufferSource");
      }
      int offset = view.getByteOffset();
      int length = view.getByteLength();
      bb.position(offset);
      bb.limit(offset + length);
      byte[] bytes = new byte[length];
      bb.get(bytes);
      return bytes;
    }
    if (input instanceof NativeArray array) {
      int length = (int) array.getLength();
      byte[] bytes = new byte[length];
      for (int i = 0; i < length; i++) {
        bytes[i] = (byte) (ScriptRuntime.toInt32(array.get(i)) & 0xFF);
      }
      return bytes;
    }
    throw ScriptRuntime.typeError("input must be a BufferSource");
  }
}
