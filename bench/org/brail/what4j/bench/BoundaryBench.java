package org.brail.what4j.bench;

import org.brail.what4j.LoadContext;
import org.brail.what4j.What4J;
import org.brail.what4j.core.BindingsLoader;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.LocalScope;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Microbenchmark of JS<->Java boundary costs in the pinned Rhino build, plus end-to-end {@code new
 * URL()} timing for a given url.js implementation.
 *
 * <p>Usage:
 *
 * <pre>
 * # Current implementation (loads core/scripts/url.js from the core jar):
 * bazel run //bench:boundary_bench
 *
 * # Any url.js from disk, e.g. a previous revision (second arg: is the "url" binding in use?):
 * git show 5365409:core/scripts/url.js > /tmp/old-url.js
 * bazel run //bench:boundary_bench -- /tmp/old-url.js false
 * </pre>
 *
 * <p>Timing: JS-side loops are timed with {@code performance.now()} (the spec-compliant High
 * Resolution Time clock, 100 microsecond resolution); each benchmark reports the best of 5 passes,
 * each pass at least 30 ms.
 */
public class BoundaryBench {
  /** Classic Rhino binding style: JS calls a public method on a Java object (reflection). */
  public static class Reflective {
    public String id(String s) {
      return s;
    }
  }

  public static void main(String[] args) throws Exception {
    boolean withUrlBinding = args.length < 1 || Boolean.parseBoolean(args[1]);
    String source;
    String label;
    if (args.length < 1) {
      label = "core jar resource core/scripts/url.js";
      source = readResource("core/scripts/url.js");
    } else {
      label = args[0];
      source = Files.readString(Path.of(args[0]));
    }

    Context cx = Context.enter();
    VarScope scope = cx.initSafeStandardObjects();
    scope.put(
        "print",
        scope,
        new LambdaFunction(
            scope,
            "print",
            1,
            (_, _s, _sl, a) -> {
              System.out.println(
                  String.join(
                      " ", java.util.Arrays.stream(a).map(String::valueOf).toArray(String[]::new)));
              return null;
            }));

    BindingsLoader bl = new BindingsLoader();
    LoadContext lc = () -> bl.makeGetBindings(cx, scope);

    // Load url.js the same way core/Utils.loadModuleResources does.
    Scriptable exports = cx.newObject(scope);
    LocalScope loadScope = new LocalScope(scope);
    loadScope.put("exports", loadScope, exports);
    loadScope.put("getBinding", loadScope, lc.getBindings());
    cx.evaluateReader(loadScope, new StringReader(source), "url.js", 1, null);
    for (Object key : exports.getIds()) {
      if (key instanceof String ks) {
        scope.put(ks, scope, exports.get(ks, exports));
      }
    }

    // The module's top-level "const urlparse = getBinding("url")" is installed
    // readonly on the outer scope by this Rhino build (no block scoping); the
    // bench JS reads it from there.
    if (withUrlBinding && !scope.has("urlparse", scope)) {
      throw new AssertionError("expected module const urlparse on outer scope");
    }

    // Load the Performance module for the spec-compliant performance.now() timer.
    new What4J(cx, scope).load(cx, scope, "Performance");

    Scriptable natives = cx.newObject(scope);
    natives.put(
        "noop", natives, new LambdaFunction(scope, "noop", 0, (c, s, sl, a) -> Undefined.instance));
    natives.put("retStr", natives, new LambdaFunction(scope, "retStr", 1, (c, s, sl, a) -> a[0]));
    natives.put("retNum", natives, new LambdaFunction(scope, "retNum", 0, (c, s, sl, a) -> 42d));
    scope.put("natives", scope, natives);
    scope.put("refl", scope, Context.toObject(new Reflective(), scope));

    System.out.println("Rhino version: " + cx.getImplementationVersion());
    System.out.println("url.js: " + label + "  (url binding: " + withUrlBinding + ")");
    cx.evaluateString(scope, BENCH_JS, "bench.js", 1, null);
    Context.exit();
  }

  private static String readResource(String path) throws IOException {
    try (InputStream in = BoundaryBench.class.getClassLoader().getResourceAsStream(path)) {
      if (in == null) {
        throw new IOException("Could not find " + path);
      }
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  static final String BENCH_JS =
      """
      // performance.now() is in milliseconds (100 microsecond resolution); the
      // bench does its math in nanoseconds.
      function nowNs() {
        return performance.now() * 1e6;
      }

      function bench(label, fn) {
        var i, best = Infinity, t0, n, more, ns, per;
        for (i = 0; i < 20000; i++) fn();
        t0 = nowNs();
        for (i = 0; i < 10000; i++) fn();
        per = Math.max((nowNs() - t0) / 10000, 1);
        for (var p = 0; p < 5; p++) {
          n = Math.max(1000, Math.floor(10e6 / per));
          t0 = nowNs();
          for (i = 0; i < n; i++) fn();
          while (nowNs() - t0 < 30e6) {
            more = n * 2;
            for (i = n; i < more; i++) fn();
            n = more;
          }
          ns = (nowNs() - t0) / n;
          if (ns < best) best = ns;
        }
        print(label + ': ' + best.toFixed(1) + ' ns/op');
      }

      var urlish = 'https://user:pa%20ss@example.com:8080/some/long/path/here?query=1&x=2#frag';
      urlish = urlish + urlish;
      var plainUrl = 'https://example.com/some/path/here?query=1&x=2#frag';
      var richUrl = 'https://user:pa%20ss@exämple.com:8080/some/long/path/here?query=1&x=é#frag';
      var qs = 'a=b&c+d=e%20f&x=%C3%A9&g=';
      var pairs = [['a', 'b'], ['c d', 'e f'], ['x', 'é'], ['g', '']];
      var cpInput = 'https://example.com/?x=éñü';

      // Warmup: exercise ICU IDNA init, caches, everything.
      for (var w = 0; w < 200; w++) new URL(richUrl);

      // One-time cost of the first reflective (NativeJavaObject) call.
      var r0 = nowNs();
      refl.id('x');
      print('reflective first call (one-time): ' + (nowNs() - r0).toFixed(0) + ' ns');

      // How many times does a realistic parse cross the boundary?
      if (typeof urlparse !== 'undefined') {
        var names = ['percentEncode', 'parseHost', 'serializeHost', 'urlencodedParse',
                     'urlencodedSerialize', 'codePoints', 'toUSVString'];
        var calls = {}, saved = {};
        for (var k = 0; k < names.length; k++) {
          calls[names[k]] = 0;
          saved[names[k]] = urlparse[names[k]];
          urlparse[names[k]] = (function (nm) {
            return function () {
              calls[nm]++;
              return saved[nm].apply(urlparse, arguments);
            };
          })(names[k]);
        }
        new URL(plainUrl);
        new URL(richUrl);
        var line = 'boundary crossings in new URL(plain) + new URL(rich):';
        for (var m = 0; m < names.length; m++) line += ' ' + names[m] + '=' + calls[names[m]];
        print(line);
        for (var q = 0; q < names.length; q++) urlparse[names[q]] = saved[names[q]];
      }

      print('--- raw boundary costs ---');
      var jsNoop = function () {};
      bench('js noop function call          ', function () { jsNoop(); });
      bench('js object property read        ', function () { return { a: 1 }.a; });
      bench('java lambda (no args)          ', function () { natives.noop(); });
      bench('java lambda (str arg, ret str) ', function () { return natives.retStr('x'); });
      bench('java lambda (no args, ret num) ', function () { return natives.retNum(); });
      bench('reflective java method (str)   ', function () { return refl.id('x'); });
      if (typeof urlparse !== 'undefined') {
        bench('binding object property read   ', function () { return urlparse.percentEncode; });
      }

      print('--- percentEncode: segment vs per-char ---');
      if (typeof urlparse !== 'undefined') {
        bench('percentEncode whole 74-ch string', function () {
          return urlparse.percentEncode(urlish, 'fragment');
        });
        bench('percentEncode per char (74 calls)', function () {
          var s = '';
          for (var j = 0; j < urlish.length; j++)
            s += urlparse.percentEncode(urlish.charAt(j), 'fragment');
          return s;
        });
      }
      function jsPercent(ch) {
        var c = ch.charCodeAt(0);
        if (c < 0x20 || c === 0x7F || c === 0x22 || c === 0x27 || c === 0x3C || c === 0x3E || c === 0x60)
          return '%' + c.toString(16).toUpperCase();
        return ch;
      }
      bench('js per-char percent (74 calls) ', function () {
        var s = '';
        for (var j = 0; j < urlish.length; j++) s += jsPercent(urlish.charAt(j));
        return s;
      });

      if (typeof urlparse !== 'undefined') {
        print('--- host parse/serialize (includes ICU for IDNA) ---');
        bench('parseHost IDNA + serialize     ', function () {
          return urlparse.serializeHost(urlparse.parseHost('exämple.com', false));
        });
        bench('parseHost ascii + serialize    ', function () {
          return urlparse.serializeHost(urlparse.parseHost('example.com', false));
        });
        bench('parseHost ipv4 + serialize     ', function () {
          return urlparse.serializeHost(urlparse.parseHost('200.1.1.1', false));
        });

        print('--- urlencoded / strings ---');
        bench('urlencodedParse (4 pairs)      ', function () { return urlparse.urlencodedParse(qs); });
        bench('urlencodedSerialize (4 pairs)  ', function () { return urlparse.urlencodedSerialize(pairs); });
        bench('codePoints (29 ch)             ', function () { return urlparse.codePoints(cpInput); });
        bench('toUSVString (29 ch)            ', function () { return urlparse.toUSVString(cpInput); });
      }

      print('--- end-to-end: new URL() ---');
      bench('new URL (plain)                ', function () { return new URL(plainUrl); });
      bench('new URL (rich, IDNA host)      ', function () { return new URL(richUrl); });
      """;
}
