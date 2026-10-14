package org.brail.what4j.bindings.encoding;

public class Utf8Decoder extends Decoder {
  private static final int EOF = -1;

  private int bytesNeeded = 0;
  private int codePoint = 0;
  private int bytesSeen = 0;
  private int lowerBoundary = 0x80;
  private int upperBoundary = 0xBF;
  private int pushed = EOF;

  public Utf8Decoder(boolean fatal, boolean ignoreBom, boolean bomRelevant) {
    super(fatal, ignoreBom, bomRelevant);
  }

  @Override
  protected String process(byte[] input, boolean doNotFlush) {
    StringBuilder out = new StringBuilder();
    int i = 0;

    while (true) {
      int b;
      if (pushed != EOF) {
        b = pushed;
        pushed = EOF;
      } else if (i < input.length) {
        b = input[i++] & 0xFF;
      } else if (doNotFlush) {
        break;
      } else {
        b = EOF;
      }

      if (b == EOF) {
        if (bytesNeeded != 0) {
          bytesNeeded = 0;
          bytesSeen = 0;
          lowerBoundary = 0x80;
          upperBoundary = 0xBF;
          emitError(out);
          continue;
        }
        break;
      }

      if (bytesNeeded == 0) {
        if (b < 0x80) {
          emit(out, b);
        } else if (b >= 0xC2 && b <= 0xDF) {
          bytesNeeded = 1;
          codePoint = b & 0x1F;
        } else if (b >= 0xE0 && b <= 0xEF) {
          if (b == 0xE0) {
            lowerBoundary = 0xA0;
          }
          if (b == 0xED) {
            upperBoundary = 0x9F;
          }
          bytesNeeded = 2;
          codePoint = b & 0x0F;
        } else if (b >= 0xF0 && b <= 0xF4) {
          if (b == 0xF0) {
            lowerBoundary = 0x90;
          }
          if (b == 0xF4) {
            upperBoundary = 0x8F;
          }
          bytesNeeded = 3;
          codePoint = b & 0x07;
        } else {
          emitError(out);
        }
        continue;
      }

      if (b < lowerBoundary || b > upperBoundary) {
        codePoint = 0;
        bytesNeeded = 0;
        bytesSeen = 0;
        lowerBoundary = 0x80;
        upperBoundary = 0xBF;
        pushed = b;
        emitError(out);
        continue;
      }

      lowerBoundary = 0x80;
      upperBoundary = 0xBF;
      codePoint = (codePoint << 6) | (b & 0x3F);
      bytesSeen++;
      if (bytesSeen != bytesNeeded) {
        continue;
      }

      int cp = codePoint;
      codePoint = 0;
      bytesNeeded = 0;
      bytesSeen = 0;
      emit(out, cp);
    }

    return out.toString();
  }
}
