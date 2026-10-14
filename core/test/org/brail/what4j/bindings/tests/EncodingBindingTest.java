package org.brail.what4j.bindings.tests;

import org.brail.what4j.bindings.Encoding;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.NativeConsole;
import org.mozilla.javascript.VarScope;

import java.util.Arrays;

public class EncodingBindingTest {
  private Context cx;
  private VarScope scope;

  @BeforeEach
  public void init() {
    cx = Context.enter();
    scope = cx.initSafeStandardObjects();
    scope.put("encoding", scope, Encoding.init(cx, scope));
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

  @Test
  public void testUtf8EncodeAscii() {
    cx.evaluateString(
        scope,
        """
        const b = encoding.utf8Encode('Hello');
        if (b.length !== 5) throw 'wrong length';
        if (b[0] !== 72 || b[4] !== 111) throw 'wrong bytes';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8EncodeNonBmp() {
    cx.evaluateString(
        scope,
        """
        const s = String.fromCharCode(0xD834, 0xDD1E);
        const b = encoding.utf8Encode(s);
        const expected = [0xF0, 0x9D, 0x84, 0x9E];
        if (b.length !== expected.length) throw 'wrong length';
        for (let i = 0; i < expected.length; i++) {
          if (b[i] !== expected[i]) throw 'wrong byte at ' + i;
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8EncodeUnpairedSurrogates() {
    cx.evaluateString(
        scope,
        """
        const s = String.fromCharCode(0xD83D, 0x20, 0xDEB2);
        const b = encoding.utf8Encode(s);
        const expected = [0xEF, 0xBF, 0xBD, 0x20, 0xEF, 0xBF, 0xBD];
        if (b.length !== expected.length) throw 'wrong length';
        for (let i = 0; i < expected.length; i++) {
          if (b[i] !== expected[i]) throw 'wrong byte at ' + i;
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8DecodeRaw() {
    cx.evaluateString(
        scope,
        """
        const s = encoding.utf8Decode([0xC3, 0xB1]);
        if (s !== 'ñ') throw 'decode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8DecodeRawDoesNotStripBom() {
    cx.evaluateString(
        scope,
        """
        const s = encoding.utf8Decode([0xEF, 0xBB, 0xBF, 0x41]);
        const expected = String.fromCharCode(0xFEFF) + 'A';
        if (s !== expected) throw 'BOM should not be stripped by raw decode';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8DecodeInvalid() {
    cx.evaluateString(
        scope,
        """
        const r = String.fromCharCode(0xFFFD);
        if (encoding.utf8Decode([0xF0, 0x80, 0x80]) !== r + r + r) throw 'F0 80 80 failed';
        if (encoding.utf8Decode([0xC0, 0x80]) !== r + r) throw 'C0 80 failed';
        if (encoding.utf8Decode([0xF0]) !== r) throw 'truncated failed';
        if (encoding.utf8Decode([0xF5]) !== r) throw 'obsolete lead failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8DecodeViewOffset() {
    cx.evaluateString(
        scope,
        """
        const buf = new Uint8Array([0x61, 0x62, 0x63, 0x64]);
        const view = new Uint8Array(buf.buffer, 1, 2);
        const s = encoding.utf8Decode(view);
        if (s !== 'bc') throw 'view offset decode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf8DecodeDataView() {
    cx.evaluateString(
        scope,
        """
        const bytes = new Uint8Array([0x26, 0x3A, 0x42]);
        const view = new DataView(bytes.buffer, 0, 2);
        const s = encoding.utf8Decode(view);
        const expected = String.fromCharCode(0x26, 0x3A);
        if (s !== expected) throw 'DataView decode failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testApiUtf8DecoderStripsBom() {
    cx.evaluateString(
        scope,
        """
        const d = encoding.newDecoder('UTF-8', false, false);
        if (d.decode([0xEF, 0xBB, 0xBF, 0x41], false) !== 'A') throw 'BOM not stripped';

        const d2 = encoding.newDecoder('UTF-8', false, true);
        const expected = String.fromCharCode(0xFEFF) + 'A';
        if (d2.decode([0xEF, 0xBB, 0xBF, 0x41], false) !== expected) throw 'ignoreBOM failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testApiUtf8DecoderStreaming() {
    cx.evaluateString(
        scope,
        """
        const d = encoding.newDecoder('UTF-8', false, false);
        if (d.decode([0xF0, 0x9F, 0x8E], true) !== '') throw 'first chunk failed';
        const expected = String.fromCodePoint(0x1F3B2);
        if (d.decode([0xB2], false) !== expected) throw 'second chunk failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testApiUtf8DecoderFatal() {
    cx.evaluateString(
        scope,
        """
        const d = encoding.newDecoder('UTF-8', true, false);
        try {
          d.decode([0xFF], false);
          throw 'did not throw';
        } catch (e) {
          if (e.name !== 'TypeError') throw e;
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf16Decode() {
    cx.evaluateString(
        scope,
        """
        const expected = String.fromCharCode(0x41, 0x6C34);

        const le = encoding.newDecoder('UTF-16LE', false, false);
        if (le.decode([0x41, 0x00, 0x34, 0x6C], false) !== expected) throw 'UTF-16LE failed';

        const be = encoding.newDecoder('UTF-16BE', false, false);
        if (be.decode([0x00, 0x41, 0x6C, 0x34], false) !== expected) throw 'UTF-16BE failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf16Streaming() {
    cx.evaluateString(
        scope,
        """
        const d = encoding.newDecoder('UTF-16LE', false, false);
        if (d.decode([0x41], true) !== '') throw 'pending byte failed';
        if (d.decode([0x00], false) !== 'A') throw 'flush failed';
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testUtf16Surrogates() {
    cx.evaluateString(
        scope,
        """
        const r = String.fromCharCode(0xFFFD);
        const d = encoding.newDecoder('UTF-16LE', false, false);
        if (d.decode([0x00, 0xD8, 0x00, 0x00], false) !== r + String.fromCharCode(0)) {
          throw 'unmatched surrogate failed';
        }

        const fatal = encoding.newDecoder('UTF-16LE', true, false);
        try {
          fatal.decode([0x00, 0xD8, 0x00, 0x00], false);
          throw 'did not throw';
        } catch (e) {
          if (e.name !== 'TypeError') throw e;
        }
        """,
        "test.js",
        1,
        null);
  }

  @Test
  public void testXUserDefined() {
    cx.evaluateString(
        scope,
        """
        const d = encoding.newDecoder('x-user-defined', false, false);
        const expected = String.fromCharCode(0x41, 0xF780, 0xF7FF);
        if (d.decode([0x41, 0x80, 0xFF], false) !== expected) throw 'x-user-defined failed';
        """,
        "test.js",
        1,
        null);
  }
}
