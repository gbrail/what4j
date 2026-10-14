package org.brail.what4j.bindings.encoding;

public class Utf16Decoder extends Decoder {
  private static final int EOF = -1;

  private final boolean bigEndian;
  private int leadingByte = EOF;
  private int leadingSurrogate = EOF;
  private int push1 = EOF;
  private int push2 = EOF;

  public Utf16Decoder(boolean bigEndian, boolean fatal, boolean ignoreBom, boolean bomRelevant) {
    super(fatal, ignoreBom, bomRelevant);
    this.bigEndian = bigEndian;
  }

  @Override
  protected String process(byte[] input, boolean doNotFlush) {
    StringBuilder out = new StringBuilder();
    int i = 0;

    while (true) {
      int b;
      if (push1 != EOF) {
        b = push1;
        push1 = push2;
        push2 = EOF;
      } else if (i < input.length) {
        b = input[i++] & 0xFF;
      } else if (doNotFlush) {
        break;
      } else {
        b = EOF;
      }

      if (b == EOF) {
        if (leadingByte != EOF || leadingSurrogate != EOF) {
          leadingByte = EOF;
          leadingSurrogate = EOF;
          emitError(out);
          continue;
        }
        break;
      }

      if (leadingByte == EOF) {
        leadingByte = b;
        continue;
      }

      int codeUnit = bigEndian ? ((leadingByte << 8) | b) : ((b << 8) | leadingByte);
      leadingByte = EOF;

      if (leadingSurrogate != EOF) {
        int leading = leadingSurrogate;
        leadingSurrogate = EOF;
        if (isTrailingSurrogate(codeUnit)) {
          emit(out, scalarValueFromSurrogates(leading, codeUnit));
          continue;
        }
        int byte1 = codeUnit >> 8;
        int byte2 = codeUnit & 0xFF;
        push1 = bigEndian ? byte1 : byte2;
        push2 = bigEndian ? byte2 : byte1;
        emitError(out);
        continue;
      }

      if (isLeadingSurrogate(codeUnit)) {
        leadingSurrogate = codeUnit;
        continue;
      }
      if (isTrailingSurrogate(codeUnit)) {
        emitError(out);
        continue;
      }
      emit(out, codeUnit);
    }

    return out.toString();
  }

  static boolean isLeadingSurrogate(int codeUnit) {
    return codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
  }

  static boolean isTrailingSurrogate(int codeUnit) {
    return codeUnit >= 0xDC00 && codeUnit <= 0xDFFF;
  }

  static int scalarValueFromSurrogates(int leading, int trailing) {
    return 0x10000 + ((leading - 0xD800) << 10) + (trailing - 0xDC00);
  }
}
