package org.brail.what4j.bindings.url;

import org.brail.what4j.bindings.ICU;
import org.mozilla.javascript.ArrayLikeAbstractOperations;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.IteratorLikeIterable;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

import java.util.Arrays;
import java.util.Locale;

/** Host parsing and serialization (the spec's "host" production). */
public final class Hosts {
  private Hosts() {}

  /** The spec's "host parser". Returns null on failure. */
  public static Host parseHost(String input, boolean isOpaque, ICU icu) {
    if (!input.isEmpty() && input.charAt(0) == '[') {
      if (!input.endsWith("]")) return null;
      int[] pieces = ipv6Parser(input.substring(1, input.length() - 1));
      if (pieces == null) return null;
      return new Host("ipv6", null, pieces);
    }
    if (isOpaque) {
      if (containsForbiddenHostCodePoint(input)) return null;
      return new Host("opaque", Percent.percentEncode(input, Percent.C0_CONTROL, false), null);
    }
    String domain = Percent.percentDecodeString(input);
    String asciiDomain = domainParser(domain, false, icu);
    if (asciiDomain == null) return null;
    if (endsInNumberChecker(asciiDomain)) {
      Long ipv4 = ipv4Parser(asciiDomain);
      if (ipv4 == null) return null;
      return new Host("ipv4", ipv4, null);
    }
    return new Host("domain", asciiDomain, null);
  }

  /**
   * The spec's "host serializer". Accepts a {@link Host}, a JS host object (the JS-side "empty"
   * host), or null/undefined.
   */
  public static String serializeHost(VarScope s, Object host) {
    if (host == null || Undefined.isUndefined(host)) return "";
    if (host instanceof Host(String type, Object value, int[] pieces)) {
      return switch (type) {
        case "ipv4" -> ipv4Serializer(((Number) value).longValue());
        case "ipv6" -> "[" + ipv6Serializer(pieces) + "]";
        default -> value.toString();
      };
    }
    var ho = ScriptRuntime.toObject(s, host);
    String type = Context.toString(ho.get("type", ho));
    return switch (type) {
      case "ipv4" -> ipv4Serializer(ScriptRuntime.toInt32(ho.get("value", ho)));
      case "ipv6" -> "[" + ipv6Serializer(toInts(ho.get("pieces", ho))) + "]";
      default -> Context.toString(ho.get("value", ho));
    };
  }

  private static int[] toInts(Object value) {
    if (!(value instanceof NativeArray arr)) {
      throw ScriptRuntime.typeError("Expected array");
    }
    int n = (int) arr.getLength();
    int[] out = new int[n];
    for (int i = 0; i < n; i++) {
      out[i] = ScriptRuntime.toInt32(arr.get(i));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Domains
  // ---------------------------------------------------------------------------

  static String domainParser(String domain, boolean beStrict, ICU icu) {
    String strictResult = icu.toAsciiImpl(domain, true);
    if (beStrict) {
      return strictResult;
    }
    String result;
    if (isASCIIStr(domain)) {
      result = domain.toLowerCase(Locale.ROOT);
    } else {
      result = icu.toAsciiImpl(domain, false);
      if (result == null) return null;
    }
    if (result.isEmpty()) return null;
    if (containsForbiddenDomainCodePoint(result)) return null;
    return result;
  }

  private static boolean isASCIIStr(String str) {
    for (int i = 0; i < str.length(); i++) {
      if (str.charAt(i) > 0x7F) return false;
    }
    return true;
  }

  private static boolean containsForbiddenDomainCodePoint(String str) {
    for (int cp : str.codePoints().toArray()) {
      if (cp <= 0x20 || cp == 0x7F || cp == 0x25) return true;
      switch (cp) {
        case 0x23:
        case 0x2F:
        case 0x3A:
        case 0x3C:
        case 0x3E:
        case 0x3F:
        case 0x40:
        case 0x5B:
        case 0x5C:
        case 0x5D:
        case 0x5E:
        case 0x7C:
          return true;
        default:
      }
    }
    return false;
  }

  private static boolean containsForbiddenHostCodePoint(String str) {
    for (int cp : str.codePoints().toArray()) {
      switch (cp) {
        case 0x00:
        case 0x09:
        case 0x0A:
        case 0x0D:
        case 0x20:
        case 0x23:
        case 0x2F:
        case 0x3A:
        case 0x3C:
        case 0x3E:
        case 0x3F:
        case 0x40:
        case 0x5B:
        case 0x5C:
        case 0x5D:
        case 0x5E:
        case 0x7C:
          return true;
        default:
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // IPv4
  // ---------------------------------------------------------------------------

  /**
   * The spec's "IPv4 number parser". Returns null on failure; a value that overflows 64 bits
   * returns Long.MAX_VALUE, which is still rejected by the same range checks the spec's float
   * arithmetic applies.
   */
  private static Long ipv4NumberParser(String input) {
    if (input.isEmpty()) return null;
    int start = 0;
    int radix = 10;
    if (input.length() >= 2 && (input.startsWith("0X") || input.startsWith("0x"))) {
      start = 2;
      radix = 16;
    } else if (input.length() >= 2 && input.charAt(0) == '0') {
      start = 1;
      radix = 8;
    }
    String body = input.substring(start);
    if (body.isEmpty()) return 0L;
    for (int i = 0; i < body.length(); i++) {
      int c = body.charAt(i);
      boolean valid = false;
      if (c >= '0' && c <= '9' && c - '0' < radix) {
        valid = true;
      } else if (radix == 16 && ((c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f'))) {
        valid = true;
      }
      if (!valid) return null;
    }
    try {
      return Long.parseLong(body, radix);
    } catch (NumberFormatException e) {
      return Long.MAX_VALUE;
    }
  }

  private static boolean isAllASCIIDigits(String str) {
    if (str.isEmpty()) return false;
    for (int i = 0; i < str.length(); i++) {
      if (!Percent.isASCIIDigit(str.charAt(i))) return false;
    }
    return true;
  }

  /** The spec's "IPv4 parser". Returns the address (0..2^32-1) or null. */
  static Long ipv4Parser(String input) {
    String[] parts = input.split("\\.", -1);
    if (parts.length > 1 && parts[parts.length - 1].isEmpty()) {
      parts = Arrays.copyOf(parts, parts.length - 1);
    }
    if (parts.length > 4) return null;
    long[] numbers = new long[parts.length];
    for (int i = 0; i < parts.length; i++) {
      Long result = ipv4NumberParser(parts[i]);
      if (result == null) return null;
      numbers[i] = result;
    }
    for (int a = 0; a < numbers.length - 1; a++) {
      if (numbers[a] > 255) return null;
    }
    if (numbers[numbers.length - 1] >= pow256(5 - numbers.length)) return null;
    long ipv4 = numbers[numbers.length - 1];
    int counter = 0;
    for (int b = 0; b < numbers.length - 1; b++) {
      ipv4 += numbers[b] * pow256(3 - counter);
      counter++;
    }
    return ipv4;
  }

  private static long pow256(int n) {
    return 1L << (8 * n);
  }

  static boolean endsInNumberChecker(String input) {
    String[] parts = input.split("\\.", -1);
    if (parts[parts.length - 1].isEmpty()) {
      parts = Arrays.copyOf(parts, parts.length - 1);
    }
    String last = parts.length > 0 ? parts[parts.length - 1] : "";
    if (!last.isEmpty() && isAllASCIIDigits(last)) return true;
    return ipv4NumberParser(last) != null;
  }

  static String ipv4Serializer(long address) {
    int[] octets = new int[4];
    long n = address;
    for (int i = 0; i < 4; i++) {
      octets[i] = (int) (n & 0xFF);
      n >>= 8;
    }
    return octets[3] + "." + octets[2] + "." + octets[1] + "." + octets[0];
  }

  // ---------------------------------------------------------------------------
  // IPv6
  // ---------------------------------------------------------------------------

  private static int cpAt(int[] cps, int p) {
    return p >= 0 && p < cps.length ? cps[p] : -1;
  }

  /** The spec's "IPv6 parser". Returns eight 16-bit pieces or null. */
  static int[] ipv6Parser(String input) {
    int[] address = new int[8];
    int[] cps = input.codePoints().toArray();
    int pieceIndex = 0;
    Integer compress = null;
    int pointer = 0;

    if (cpAt(cps, 0) == 0x3A) {
      if (cpAt(cps, 1) != 0x3A) return null;
      pointer += 2;
      pieceIndex += 1;
      compress = pieceIndex;
    }

    while (cpAt(cps, pointer) != -1) {
      if (pieceIndex == 8) return null;
      int c = cpAt(cps, pointer);
      if (c == 0x3A) {
        if (compress != null) return null;
        pointer += 1;
        pieceIndex += 1;
        compress = pieceIndex;
        continue;
      }
      int value = 0;
      int length = 0;
      while (length < 4 && Percent.isASCIIHexDigit(cpAt(cps, pointer))) {
        value = value * 0x10 + Percent.hexValue(cpAt(cps, pointer));
        pointer += 1;
        length += 1;
      }
      if (cpAt(cps, pointer) == 0x2E) {
        if (length == 0) return null;
        pointer -= length;
        if (pieceIndex > 6) return null;
        int numbersSeen = 0;
        while (cpAt(cps, pointer) != -1) {
          Integer ipv4Piece = null;
          if (numbersSeen > 0) {
            if (cpAt(cps, pointer) == 0x2E && numbersSeen < 4) {
              pointer += 1;
            } else {
              return null;
            }
          }
          if (!Percent.isASCIIDigit(cpAt(cps, pointer))) return null;
          while (Percent.isASCIIDigit(cpAt(cps, pointer))) {
            int number = cpAt(cps, pointer) - 0x30;
            if (ipv4Piece == null) {
              ipv4Piece = number;
            } else if (ipv4Piece == 0) {
              return null;
            } else {
              ipv4Piece = ipv4Piece * 10 + number;
            }
            if (ipv4Piece > 255) return null;
            pointer += 1;
          }
          address[pieceIndex] = address[pieceIndex] * 0x100 + ipv4Piece;
          numbersSeen += 1;
          if (numbersSeen == 2 || numbersSeen == 4) pieceIndex += 1;
        }
        if (numbersSeen != 4) return null;
        break;
      } else if (cpAt(cps, pointer) == 0x3A) {
        pointer += 1;
        if (cpAt(cps, pointer) == -1) return null;
      } else if (cpAt(cps, pointer) != -1) {
        return null;
      }
      address[pieceIndex] = value;
      pieceIndex += 1;
    }

    if (compress != null) {
      int swaps = pieceIndex - compress;
      pieceIndex = 7;
      while (pieceIndex != 0 && swaps > 0) {
        int tmp = address[pieceIndex];
        address[pieceIndex] = address[compress + swaps - 1];
        address[compress + swaps - 1] = tmp;
        pieceIndex -= 1;
        swaps -= 1;
      }
    } else if (pieceIndex != 8) {
      return null;
    }
    return address;
  }

  private static Integer findIpv6CompressedPieceIndex(int[] pieces) {
    Integer longestIndex = null;
    int longestSize = 1;
    Integer foundIndex = null;
    int foundSize = 0;
    for (int i = 0; i < pieces.length; i++) {
      if (pieces[i] != 0) {
        if (foundSize > longestSize) {
          longestIndex = foundIndex;
          longestSize = foundSize;
        }
        foundIndex = null;
        foundSize = 0;
      } else {
        if (foundIndex == null) foundIndex = i;
        foundSize++;
      }
    }
    if (foundSize > longestSize) return foundIndex;
    return longestIndex;
  }

  static String ipv6Serializer(int[] pieces) {
    StringBuilder out = new StringBuilder();
    Integer compress = findIpv6CompressedPieceIndex(pieces);
    boolean ignore0 = false;
    for (int i = 0; i < pieces.length; i++) {
      if (ignore0 && pieces[i] == 0) continue;
      if (ignore0) ignore0 = false;
      if (compress != null && compress == i) {
        out.append(i == 0 ? "::" : ":");
        ignore0 = true;
        continue;
      }
      out.append(Integer.toHexString(pieces[i]));
      if (i != 7) out.append(':');
    }
    return out.toString();
  }
}
