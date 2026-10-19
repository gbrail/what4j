package org.brail.what4j.bindings.tests;

import org.brail.what4j.bindings.Url;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.NativeConsole;
import org.mozilla.javascript.VarScope;

import java.util.Arrays;

public class UrlBindingTest {
  private Context cx;
  private VarScope scope;

  @BeforeEach
  public void init() {
    cx = Context.enter();
    scope = cx.initSafeStandardObjects();
    scope.put("urlparse", scope, Url.init(cx, scope));
    NativeConsole.init(
        scope,
        false,
        (_, _, _level, args, _stack) -> {
          if (args.length == 1) {
            System.out.println(args[0].toString());
          } else if (args.length > 1) {
            System.out.println(
                String.join(" ", Arrays.stream(args).map(Object::toString).toArray(String[]::new)));
          }
        });
  }

  @AfterEach
  public void close() {
    Context.exit();
  }

  // ---------------------------------------------------------------------------
  // percentEncode
  // ---------------------------------------------------------------------------

  @Test
  public void testPercentEncodeC0Control() {
    cx.evaluateString(
        scope,
        """
        const ctrl = String.fromCharCode(0x01);
        const del = String.fromCharCode(0x7F);
        if (urlparse.percentEncode('a' + ctrl + 'b' + del, 'c0-control') !== 'a%01b%7F')
          throw 'c0-control encode failed';
        if (urlparse.percentEncode('a b', 'c0-control') !== 'a b') throw 'space must survive';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testPercentEncodeFragment() {
    cx.evaluateString(
        scope,
        """
        if (urlparse.percentEncode('a b"c<d>e`f#g', 'fragment') !== 'a%20b%22c%3Cd%3Ee%60f#g')
          throw 'fragment encode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testPercentEncodeQueryAndSpecialQuery() {
    cx.evaluateString(
        scope,
        """
        if (urlparse.percentEncode('a"b#c<d>', 'query') !== 'a%22b%23c%3Cd%3E')
          throw 'query encode failed';
        if (urlparse.percentEncode("a'b", 'query') !== "a'b") throw 'apostrophe must survive query';
        if (urlparse.percentEncode("a'b", 'special-query') !== 'a%27b')
          throw 'special-query encode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testPercentEncodePath() {
    cx.evaluateString(
        scope,
        """
        if (urlparse.percentEncode('a?b^c`d{e}', 'path') !== 'a%3Fb%5Ec%60d%7Be%7D')
          throw 'path encode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testPercentEncodeUserinfo() {
    cx.evaluateString(
        scope,
        """
        if (urlparse.percentEncode('a/b:c;d=e@f[g\\\\h]i|j?k', 'userinfo')
            !== 'a%2Fb%3Ac%3Bd%3De%40f%5Bg%5Ch%5Di%7Cj%3Fk')
          throw 'userinfo encode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testPercentEncodeUtf8() {
    cx.evaluateString(
        scope,
        """
        if (urlparse.percentEncode('é', 'fragment') !== '%C3%A9') throw 'two-byte UTF-8 failed';
        const emoji = String.fromCharCode(0xD83C, 0xDFB2);
        if (urlparse.percentEncode(emoji, 'fragment') !== '%F0%9F%8E%B2')
          throw 'astral UTF-8 failed';
        const unpaired = String.fromCharCode(0xD800);
        if (urlparse.percentEncode(unpaired + 'a', 'fragment') !== '%EF%BF%BDa')
          throw 'unpaired surrogate must encode as U+FFFD';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testPercentEncodeUnknownSet() {
    cx.evaluateString(
        scope,
        """
        try {
          urlparse.percentEncode('a', 'bogus');
          throw 'did not throw';
        } catch (e) {
          if (e.name !== 'Error') throw e;
        }
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // parseHost: IPv4
  // ---------------------------------------------------------------------------

  @Test
  public void testParseHostIpv4() {
    cx.evaluateString(
        scope,
        """
        const cases = [
          ['1.2.3.4', '1.2.3.4'],
          ['1.2.3', '1.2.0.3'],
          ['1.2.3.4.', '1.2.3.4'],
          ['0101.1', '65.0.0.1'],
          ['0x7f.1', '127.0.0.1'],
          ['2130706433', '127.0.0.1'],
          ['200.1.1.1', '200.1.1.1'],
        ];
        for (const [input, expected] of cases) {
          const h = urlparse.parseHost(input, false);
          if (h === undefined) throw 'parse failed for ' + input;
          if (h.type !== 'ipv4') throw 'not ipv4 for ' + input;
          if (urlparse.serializeHost(h) !== expected)
            throw 'serialize failed for ' + input + ': ' + urlparse.serializeHost(h);
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testParseHostIpv4ValueAboveTwoPow31() {
    cx.evaluateString(
        scope,
        """
        const h = urlparse.parseHost('200.1.1.1', false);
        if (h.value !== 3355508993) throw 'value mismatch: ' + h.value;
        if (typeof h.value !== 'number') throw 'value must be a JS number';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testParseHostIpv4Failure() {
    cx.evaluateString(
        scope,
        """
        for (const input of ['1.2.3.4.5', '256.1.1.1', '1.2.3.999', '256.256.256.256', '0x100.1']) {
          if (urlparse.parseHost(input, false) !== undefined)
            throw 'expected failure for ' + input;
        }
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // parseHost: IPv6
  // ---------------------------------------------------------------------------

  @Test
  public void testParseHostIpv6() {
    cx.evaluateString(
        scope,
        """
        const cases = [
          ['::1', '[::1]'],
          ['::', '[::]'],
          ['1:2:3:4:5:6:7:8', '[1:2:3:4:5:6:7:8]'],
          ['2001:db8::1', '[2001:db8::1]'],
          ['2001:DB8::1', '[2001:db8::1]'],
          ['1:2:3:4:5:6:7:0', '[1:2:3:4:5:6:7:0]'],
          ['::ffff:1.2.3.4', '[::ffff:102:304]'],
          ['1:2:3:4:5:6:1.2.3.4', '[1:2:3:4:5:6:102:304]'],
        ];
        for (const [input, expected] of cases) {
          const h = urlparse.parseHost('[' + input + ']', false);
          if (h === undefined) throw 'parse failed for ' + input;
          if (h.type !== 'ipv6') throw 'not ipv6 for ' + input;
          if (!Array.isArray(h.pieces) || h.pieces.length !== 8) throw 'bad pieces for ' + input;
          if (urlparse.serializeHost(h) !== expected)
            throw 'serialize failed for ' + input + ': ' + urlparse.serializeHost(h);
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testParseHostIpv6Pieces() {
    cx.evaluateString(
        scope,
        """
        const h = urlparse.parseHost('[::1]', false);
        const expected = [0, 0, 0, 0, 0, 0, 0, 1];
        for (let i = 0; i < 8; i++) {
          if (h.pieces[i] !== expected[i]) throw 'piece ' + i + ' mismatch';
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testParseHostIpv6Failure() {
    cx.evaluateString(
        scope,
        """
        for (const input of
             ['1:2:3:4:5:6:7:8:9', '1::2::3', '1:2:3:4:5:6:7:1.2.3.4', '1:2:3:g', '1.2.3.4']) {
          if (urlparse.parseHost('[' + input + ']', false) !== undefined)
            throw 'expected failure for ' + input;
        }
        if (urlparse.parseHost('[1:2:3:4:5:6:7:8', false) !== undefined)
          throw 'expected failure for missing closing bracket';
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // parseHost: domains
  // ---------------------------------------------------------------------------

  @Test
  public void testParseHostDomain() {
    cx.evaluateString(
        scope,
        """
        const cases = [
          ['EXAMPLE.com', 'example.com'],
          ['exämple.com', 'xn--exmple-cua.com'],
          ['faß.de', 'xn--fa-hia.de'],
          ['%61bc', 'abc'],
        ];
        for (const [input, expected] of cases) {
          const h = urlparse.parseHost(input, false);
          if (h === undefined) throw 'parse failed for ' + input;
          if (h.type !== 'domain' || h.value !== expected)
            throw 'domain mismatch for ' + input + ': ' + (h.value || h);
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testParseHostDomainFailure() {
    cx.evaluateString(
        scope,
        """
        const lrm = String.fromCharCode(0x200E);
        const zwj = String.fromCharCode(0x200D);
        for (const input of
             ['', 'exa mple.com', 'exa%25mple', 'a' + lrm + 'b', 'a' + zwj + 'b', '::1']) {
          if (urlparse.parseHost(input, false) !== undefined)
            throw 'expected failure for ' + input;
        }
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // parseHost: opaque hosts
  // ---------------------------------------------------------------------------

  @Test
  public void testParseHostOpaque() {
    cx.evaluateString(
        scope,
        """
        const ctrl = String.fromCharCode(0x01);
        const cases = [
          ['foo' + ctrl, 'foo%01'],
          ['exämple', 'ex%C3%A4mple'],
          ['', ''],
        ];
        for (const [input, expected] of cases) {
          const h = urlparse.parseHost(input, true);
          if (h === undefined) throw 'parse failed for ' + input;
          if (h.type !== 'opaque' || h.value !== expected)
            throw 'opaque mismatch for ' + input + ': ' + (h.value || h);
          if (urlparse.serializeHost(h) !== expected) throw 'serialize failed for ' + input;
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testParseHostOpaqueFailure() {
    cx.evaluateString(
        scope,
        """
        for (const input of ['foo bar', 'foo:bar', 'foo/baz', 'foo#baz', 'foo|baz']) {
          if (urlparse.parseHost(input, true) !== undefined)
            throw 'expected failure for ' + input;
        }
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // serializeHost
  // ---------------------------------------------------------------------------

  @Test
  public void testSerializeHostEmpty() {
    cx.evaluateString(
        scope,
        """
        if (urlparse.serializeHost(null) !== '') throw 'null must serialize to empty';
        if (urlparse.serializeHost(undefined) !== '') throw 'undefined must serialize to empty';
        const empty = { type: 'empty', value: '' };
        if (urlparse.serializeHost(empty) !== '') throw 'empty host must serialize to empty';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testSerializeHostIpv6FromJsObject() {
    cx.evaluateString(
        scope,
        """
        const h = { type: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] };
        if (urlparse.serializeHost(h) !== '[::1]') throw 'JS ipv6 object serialize failed';
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // urlencoded parse
  // ---------------------------------------------------------------------------

  @Test
  public void testUrlencodedParseBasic() {
    cx.evaluateString(
        scope,
        """
        const p = urlparse.urlencodedParse('a=b');
        if (p.length !== 1 || p[0][0] !== 'a' || p[0][1] !== 'b') throw 'single pair failed';

        const q = urlparse.urlencodedParse('a=b&c=d');
        if (q.length !== 2) throw 'pair count failed';
        if (q[0][0] !== 'a' || q[0][1] !== 'b' || q[1][0] !== 'c' || q[1][1] !== 'd')
          throw 'pair values failed';

        const noValue = urlparse.urlencodedParse('a');
        if (noValue.length !== 1 || noValue[0][1] !== '') throw 'missing value failed';

        const emptyValue = urlparse.urlencodedParse('a=');
        if (emptyValue.length !== 1 || emptyValue[0][1] !== '') throw 'empty value failed';

        const empty = urlparse.urlencodedParse('');
        if (empty.length !== 0) throw 'empty input must parse to no pairs';

        const skipped = urlparse.urlencodedParse('a&&b');
        if (skipped.length !== 2) throw 'empty segment must be skipped';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUrlencodedParsePlusAndPercent() {
    cx.evaluateString(
        scope,
        """
        const plus = urlparse.urlencodedParse('a+b=c+d');
        if (plus[0][0] !== 'a b' || plus[0][1] !== 'c d') throw '+ must become space';

        const hex = urlparse.urlencodedParse('a=%41');
        if (hex[0][1] !== 'A') throw 'percent-decode failed';

        const utf8 = urlparse.urlencodedParse('%C3%A9');
        if (utf8[0][0] !== 'é') throw 'UTF-8 decode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUrlencodedParseInvalidUtf8() {
    cx.evaluateString(
        scope,
        """
        const r = String.fromCharCode(0xFFFD);
        const bad = urlparse.urlencodedParse('a=%FF');
        if (bad[0][1] !== r) throw 'lone continuation byte must become U+FFFD';
        const truncated = urlparse.urlencodedParse('a=%C3');
        if (truncated[0][1] !== r) throw 'truncated sequence must become U+FFFD';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUrlencodedParseShape() {
    cx.evaluateString(
        scope,
        """
        const p = urlparse.urlencodedParse('a=b');
        if (!Array.isArray(p)) throw 'result must be a JS array';
        if (!Array.isArray(p[0]) || p[0].length !== 2) throw 'pair must be a JS array';
        if (typeof p[0][0] !== 'string' || typeof p[0][1] !== 'string')
          throw 'name and value must be strings';
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // urlencoded serialize
  // ---------------------------------------------------------------------------

  @Test
  public void testUrlencodedSerialize() {
    cx.evaluateString(
        scope,
        """
        const s = (pairs) => urlparse.urlencodedSerialize(pairs);
        if (s([['a b', 'c+d']]) !== 'a+b=c%2Bd') throw 'space/plus failed';
        if (s([['a', 'b'], ['c', 'd']]) !== 'a=b&c=d') throw 'multi-pair failed';
        if (s([['é', 'x']]) !== '%C3%A9=x') throw 'UTF-8 failed';
        if (s([['a!b', 'x~y$z']]) !== 'a%21b=x%7Ey%24z') throw 'form set failed';
        if (s([]) !== '') throw 'empty list must serialize to empty';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUrlencodedSerializeUnpairedSurrogate() {
    cx.evaluateString(
        scope,
        """
        const unpaired = String.fromCharCode(0xD800);
        const s = urlparse.urlencodedSerialize([[unpaired, 'x']]);
        if (s !== '%EF%BF%BD=x') throw 'unpaired surrogate must encode as U+FFFD';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUrlencodedRoundTrip() {
    cx.evaluateString(
        scope,
        """
        const pairs = [['a b', 'c+d'], ['é', "x'y"], ['k', '']];
        const parsed = urlparse.urlencodedParse(urlparse.urlencodedSerialize(pairs));
        for (let i = 0; i < pairs.length; i++) {
          if (parsed[i][0] !== pairs[i][0] || parsed[i][1] !== pairs[i][1])
            throw 'round trip failed at ' + i;
        }
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // toUSVString
  // ---------------------------------------------------------------------------

  @Test
  public void testToUSVString() {
    cx.evaluateString(
        scope,
        """
        const r = String.fromCharCode(0xFFFD);
        const high = String.fromCharCode(0xD800);
        const low = String.fromCharCode(0xDC00);
        if (urlparse.toUSVString('abc') !== 'abc') throw 'plain string failed';
        if (urlparse.toUSVString(high) !== r) throw 'lone high surrogate failed';
        if (urlparse.toUSVString(low + 'x') !== r + 'x') throw 'lone low surrogate failed';
        const astral = String.fromCharCode(0xD834, 0xDD1E);
        if (urlparse.toUSVString(astral) !== astral) throw 'paired surrogate failed';
        if (urlparse.toUSVString(123) !== '123') throw 'non-string coercion failed';
        """,
        "test.js",
        1,
        null);
  }

  // ---------------------------------------------------------------------------
  // codePoints
  // ---------------------------------------------------------------------------

  @Test
  public void testCodePoints() {
    cx.evaluateString(
        scope,
        """
        const cps = urlparse.codePoints('abc');
        if (!Array.isArray(cps)) throw 'must be a JS array';
        if (cps.length !== 3 || cps[0] !== 97 || cps[1] !== 98 || cps[2] !== 99)
          throw 'basic code points failed';

        const astral = String.fromCodePoint(0x1D41E);
        const a = urlparse.codePoints(astral);
        if (a.length !== 1 || a[0] !== 0x1D41E) throw 'astral code point failed';

        const empty = urlparse.codePoints('');
        if (empty.length !== 0) throw 'empty string must have no code points';

        const unpaired = String.fromCharCode(0xD800);
        const u = urlparse.codePoints(unpaired + 'x');
        if (u.length !== 2 || u[0] !== 0xD800 || u[1] !== 0x78) throw 'unpaired surrogate failed';

        if (cps.slice(1, 2).length !== 1 || cps.slice(1, 2)[0] !== 98) throw 'array-ness failed';
        """,
        "test.js",
        1,
        null);
  }
}
