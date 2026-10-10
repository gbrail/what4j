package org.brail.what4j.bindings.tests;

import org.brail.what4j.bindings.Text;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.NativeConsole;
import org.mozilla.javascript.VarScope;

import java.util.Arrays;

public class TextTest {
  private Context cx;
  private VarScope scope;
  private Text binding;

  @BeforeEach
  public void init() {
    cx = Context.enter();
    scope = cx.initStandardObjects();
    var textBinding = Text.init(cx, scope);
    scope.put("text", scope, textBinding);
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
  public void testEncDec() {
    cx.evaluateString(scope,
"""
const expected = 'Hello, World!';
let result = text.utf8Decode(text.utf8Encode(expected));
if (result !== expected) {
  throw 'Did not work';
}
""", "test.js", 1, null);
  }

  @Test
  public void testEncode() {
  cx.evaluateString(scope,
"""
const enc = text.utf8Encode('Hello');
if (enc.length !== 5) {
  throw 'wrong length';
}
if (enc[0] !== 72) {
  throw 'Expected 72 in position 0';
}
if (enc[4] !== 111) {
  throw 'Expected 111 in position 4';
}
""", "test.js", 1, null);
  }

  @Test
  public void testDecode() {
    cx.evaluateString(scope,
"""
const a = [72, 101, 108, 108, 111];
const dec = text.utf8Decode(a);
if (dec !== 'Hello') {
  throw "Decoding did not work";
}
""", "test.js", 1, null);
  }

  @Test
  public void testEncodeBig() {
    cx.evaluateString(scope,
"""
const a = text.utf8Encode('ñ');
console.log('len = %d', a.length);
console.log('[0] = %d [1] = %d', a[0], a[1]);
""", "test.js", 1, null);
  }

  @Test
  public void testDecodeBig() {
    cx.evaluateString(scope,
"""
const a = [195, 177];
const s = text.utf8Decode(a);
if (s !== 'ñ') {
  throw 'Decode did not work';
}
""", "test.js", 1, null);
  }

  @Test
  public void testEncDecBig() {
    cx.evaluateString(scope,
"""
const expected = 'ñ';
const result = text.utf8Decode(text.utf8Encode(expected));
if (result !== expected) {
  throw 'Did not work';
}
""", "test.js", 1, null);
  }
}
