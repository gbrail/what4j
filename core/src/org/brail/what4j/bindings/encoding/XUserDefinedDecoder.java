package org.brail.what4j.bindings.encoding;

public class XUserDefinedDecoder extends Decoder {
  public XUserDefinedDecoder() {
    super(false, false, false);
  }

  @Override
  protected String process(byte[] input, boolean doNotFlush) {
    StringBuilder out = new StringBuilder();
    for (byte x : input) {
      int b = x & 0xFF;
      emit(out, b < 0x80 ? b : 0xF780 + b - 0x80);
    }
    return out.toString();
  }
}
