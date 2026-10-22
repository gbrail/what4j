package org.brail.what4j.testrunner;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.BiConsumer;

import org.jsoup.Jsoup;
import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.NativeConsole;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

public class WPTTestLauncher {
  static final String TEST_BASE = "../testcases";

  private static final String PRE_HARNESS_SCRIPT =
      """
  var self = globalThis;
  var location = { search: "" };
  """;

  private static final String POST_HARNESS_SCRIPT =
      """
    function __post_harness(resultCallback, completionTracker) {
      setup(null, {
        debug: false
      });
      add_result_callback(resultCallback);
      add_completion_callback(completionTracker);
    }; __post_harness;
  """;

  private final StringBuilder harnessSource;
  private final String shimsSource;
  private final List<BiConsumer<Context, VarScope>> setupCallbacks = new ArrayList<>();
  private String fetchBase;

  public record TestCase(String fileName, String source) {}

  public static WPTTestLauncher newLauncher() throws IOException {
    var s = new StringBuilder(Utils.readResource("wpt/resources/testharness.js"));
    var shims = Utils.readResource("testrunner/scripts/platform-shims.js");
    return new WPTTestLauncher(s, shims);
  }

  public void setFetchBase(String fetchBase) {
    this.fetchBase = fetchBase;
  }

  public void addSetupCallback(BiConsumer<Context, VarScope> callback) {
    setupCallbacks.add(callback);
  }

  public void addResource(String path) throws IOException {
    harnessSource.append(Utils.readFile("wpt/resource/" + path));
  }

  private WPTTestLauncher(StringBuilder script, String shims) {
    this.harnessSource = script;
    this.shimsSource = shims;
  }

  private VarScope initializeScope(Context cx, ResultTracker tracker) throws IOException {
    var scope = cx.initSafeStandardObjects();
    MinimalFetch.init(cx, scope);
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
    // Tools used by the test framework to hook into our stuff
    TestUtils.init(cx, scope);
    scope.put("__testDefer", scope, new LambdaFunction(scope, "defer", 1, WPTTestLauncher::defer));
    // V8/SpiderMonkey-style manual GC trigger hook (wpt/common/gc.js).
    scope.put("gc", scope, new LambdaFunction(scope, "gc", 0, WPTTestLauncher::gc));
    for (var c : setupCallbacks) {
      c.accept(cx, scope);
    }
    return scope;
  }

  private static Object defer(Context cx, VarScope scope, Object to, Object[] args) {
    assert args.length >= 1;
    Function deferFunc = (Function) args[0];
    cx.enqueueMicrotask(
        () -> {
          deferFunc.call(cx, scope, null, ScriptRuntime.emptyArgs);
        });
    return Undefined.instance;
  }

  private static Object gc(Context cx, VarScope scope, Object to, Object[] args) {
    System.gc();
    return Undefined.instance;
  }

  public ResultTracker runScript(Context cx, Path scriptPath, String script) throws IOException {
    return runScripts(
        cx,
        List.of(new TestCase(scriptPath.getFileName().toString(), script)),
        scriptPath.getParent());
  }

  public ResultTracker runScript(Context cx, String script) throws IOException {
    return runScripts(cx, List.of(new TestCase("test.js", script)), null);
  }

  public ResultTracker runScripts(Context cx, List<TestCase> scripts) throws IOException {
    return runScripts(cx, scripts, null);
  }

  public ResultTracker runScripts(Context cx, List<TestCase> scripts, Path basePath)
      throws IOException {
    var tracker = new ResultTracker();
    // Run each test suite in a separate scope to prevent cross-contamination.
    var scope = initializeScope(cx, tracker);

    cx.suspendMicrotaskProcessing();
    cx.evaluateString(scope, PRE_HARNESS_SCRIPT, "pre_harness.js", 1, null);
    cx.evaluateString(scope, shimsSource, "platform-shims.js", 1, null);
    cx.evaluateString(scope, harnessSource.toString(), "testharness.js", 1, null);
    if (fetchBase != null) {
      cx.evaluateString(scope, "__setFetchBase('" + fetchBase + "')", "set_fetch_base.js", 1, null);
    }
    var setup =
        (Callable) cx.evaluateString(scope, POST_HARNESS_SCRIPT, "post_harness.js", 1, null);
    setup.call(
        cx,
        scope,
        null,
        new Object[] {tracker.getResultCallback(scope), tracker.getCompletionCallback(scope)});

    try {
      for (var s : scripts) {
        if (basePath != null) {
          HelperLoader.loadHelpers(cx, scope, s.source(), basePath);
        }
        cx.evaluateString(scope, s.source(), s.fileName(), 1, null);
      }
    } catch (RhinoException e) {
      tracker.trackScriptException(e);
    }

    cx.resumeMicrotaskProcessing();

    return tracker;
  }

  public ResultTracker runHtml(Context cx, Path htmlPath, String htmlSource) throws IOException {
    var doc = Jsoup.parse(htmlSource);
    var scripts = doc.select("script");
    var allSource = new ArrayList<TestCase>();
    for (var script : scripts) {
      var src = script.attr("src");
      if (!src.isEmpty()) {
        if (!"/resources/testharness.js".equals(src)
            && !"/resources/testharnessreport.js".equals(src)) {
          var subSrcPath = htmlPath.getParent().resolve(src);
          var subSrc = Utils.readRawFilePath(subSrcPath);
          System.out.println("Adding " + src);
          allSource.add(new TestCase(src, subSrc));
        }
      } else {
        allSource.add(new TestCase("test.js", script.data()));
      }
    }
    if (allSource.isEmpty()) {
      throw new AssertionError("No scripts in HTML");
    }
    return runScripts(cx, allSource);
  }

  /*
  public ResultTracker runFile(Context cx, String path) throws IOException {
    var tracker = new ResultTracker();
    var scope = initializeScope(cx, tracker);
    var testPath = Path.of(path);
    var script = Files.readString(testPath);
    var setBase = (Function) scope.get("__setFetchBase", scope);
    var pp = testPath.getParent();
    if (pp.getNameCount() <= 2) {
      throw new AssertionError("too short: " + pp);
    }
    HelperLoader.loadHelpers(cx, scope, script, testPath.getParent());
    setBase.call(cx, scope, null, new Object[] {testPath.getParent().toString()});
    try {
      cx.evaluateString(scope, testHarness + script, testPath.getFileName().toString(), 1, null);
    } catch (Throwable t) {
      tracker.trackException(t);
    }
    return tracker;
  }
   */

  public static Object[] findTests(String path) {
    return findTests(path, new String[] {});
  }

  public static Object[] findTests(String path, String[] exclusions) {
    var base = Path.of(TEST_BASE, path);
    ArrayList<Object> results = new ArrayList<>();
    try {
      Files.walkFileTree(
          base,
          new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path p, BasicFileAttributes attrs) {
              if (p.toFile().isFile()) {
                var name = p.toString();
                if (name.endsWith(".any.js") && !isExcluded(name, exclusions)) {
                  results.add(p.toString());
                }
              }
              return FileVisitResult.CONTINUE;
            }
          });
    } catch (IOException e) {
      throw new AssertionError(e);
    }
    return results.toArray();
  }

  private static boolean isExcluded(String name, String[] exclusions) {
    if (name.contains("idlharness")) {
      return true;
    }
    for (String ex : exclusions) {
      if (name.contains(ex)) {
        return true;
      }
    }
    return false;
  }
}
