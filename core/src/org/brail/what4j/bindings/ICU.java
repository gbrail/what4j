package org.brail.what4j.bindings;

import com.ibm.icu.text.IDNA;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** Bindings to the ICU library for character set conversion to the weird UTS46 encoding. */
public final class ICU {
  private static final int BASE_OPTIONS =
      IDNA.NONTRANSITIONAL_TO_ASCII | IDNA.CHECK_BIDI | IDNA.CHECK_CONTEXTJ | IDNA.CHECK_CONTEXTO;
  private static final IDNA NON_STRICT_IDNA = IDNA.getUTS46Instance(BASE_OPTIONS);
  private static final IDNA STRICT_IDNA = IDNA.getUTS46Instance(BASE_OPTIONS | IDNA.USE_STD3_RULES);

  private final Map<Integer, Boolean> dotCache = new HashMap<>();

  public static Scriptable init(Context cx, VarScope scope) {
    var icu = new ICU();
    var o = cx.newObject(scope);
    o.put("toASCII", o, new LambdaFunction(scope, "toASCII", 2, icu::toASCII));
    return o;
  }

  public ICU() {}

  private Object toASCII(Context cx, VarScope scope, Object self, Object[] args) {
    String domain = Context.toString(args[0]);
    boolean beStrict = Context.toBoolean(args[1]);
    String result = toAsciiImpl(domain, beStrict);
    return result == null ? Undefined.instance : result;
  }

  public String toAsciiImpl(String domain, boolean beStrict) {
    IDNA idna = beStrict ? STRICT_IDNA : NON_STRICT_IDNA;
    IDNA.Info info = new IDNA.Info();
    StringBuilder output = new StringBuilder();
    idna.nameToASCII(domain, output, info);
    if (shouldFail(idna, domain, beStrict)) {
      return null;
    }
    return output.toString().replace("\uFFFD", "");
  }

  private boolean shouldFail(IDNA idna, String domain, boolean beStrict) {
    String[] labels = normalizeDots(idna, domain).split("\\.", -1);
    for (String label : labels) {
      IDNA.Info info = new IDNA.Info();
      StringBuilder output = new StringBuilder();
      idna.labelToASCII(label, output, info);
      if (isFatal(info.getErrors(), label, beStrict)) {
        return true;
      }
    }
    return false;
  }

  private static boolean isFatal(Set<IDNA.Error> errors, String label, boolean beStrict) {
    boolean ace = isAce(label);
    boolean nonAscii = hasNonAscii(label);
    if (errors.contains(IDNA.Error.PUNYCODE) && nonAscii) {
      return true;
    }
    if (beStrict) {
      if (errors.contains(IDNA.Error.LEADING_HYPHEN)
          || errors.contains(IDNA.Error.TRAILING_HYPHEN)
          || errors.contains(IDNA.Error.HYPHEN_3_4)
          || errors.contains(IDNA.Error.LABEL_TOO_LONG)
          || errors.contains(IDNA.Error.DOMAIN_NAME_TOO_LONG)
          || errors.contains(IDNA.Error.EMPTY_LABEL)) {
        return true;
      }
    }
    if (ace) {
      return false;
    }
    return errors.contains(IDNA.Error.BIDI)
        || errors.contains(IDNA.Error.CONTEXTJ)
        || errors.contains(IDNA.Error.CONTEXTO_PUNCTUATION)
        || errors.contains(IDNA.Error.CONTEXTO_DIGITS)
        || errors.contains(IDNA.Error.DISALLOWED)
        || errors.contains(IDNA.Error.LEADING_COMBINING_MARK);
  }

  private static boolean isAce(String label) {
    return label.length() >= 4 && label.regionMatches(true, 0, "xn--", 0, 4);
  }

  private static boolean hasNonAscii(String value) {
    for (int i = 0; i < value.length(); i++) {
      if (value.charAt(i) >= 0x80) {
        return true;
      }
    }
    return false;
  }

  private String normalizeDots(IDNA idna, String domain) {
    StringBuilder output = new StringBuilder(domain.length());
    for (int i = 0; i < domain.length(); ) {
      int codePoint = domain.codePointAt(i);
      if (mapsToDot(idna, codePoint)) {
        output.append('.');
      } else {
        output.appendCodePoint(codePoint);
      }
      i += Character.charCount(codePoint);
    }
    return output.toString();
  }

  private boolean mapsToDot(IDNA idna, int codePoint) {
    Boolean cached = dotCache.get(codePoint);
    if (cached != null) {
      return cached;
    }
    String character = new String(Character.toChars(codePoint));
    IDNA.Info info = new IDNA.Info();
    StringBuilder output = new StringBuilder();
    idna.nameToASCII("a" + character + "b", output, info);
    boolean dot =
        output.length() == 3
            && output.charAt(0) == 'a'
            && output.charAt(1) == '.'
            && output.charAt(2) == 'b';
    dotCache.put(codePoint, dot);
    return dot;
  }
}
