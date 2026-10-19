package org.brail.what4j.bindings;

import org.brail.what4j.bindings.url.Hosts;
import org.brail.what4j.bindings.url.Percent;
import org.brail.what4j.bindings.url.Strings;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

/**
 * Bindings for the WHATWG URL standard's string/byte/table algorithms: percent-encoding, host
 * parsing/serialization, and the urlencoded parser/serializer. The basic URL parser state machine
 * itself stays in JS (core/scripts/url.js).
 */
public class Url {
  public static Scriptable init(Context cx, VarScope scope) {
    var icu = new ICU();
    var o = cx.newObject(scope);
    o.put("percentEncode", o, new LambdaFunction(scope, "percentEncode", 2, Url::percentEncode));
    o.put(
        "parseHost",
        o,
        new LambdaFunction(
            scope,
            "parseHost",
            2,
            (Context c, VarScope s, Object self, Object[] args) -> {
              var host =
                  Hosts.parseHost(Context.toString(args[0]), Context.toBoolean(args[1]), icu);
              if (host == null) {
                return Undefined.instance;
              }
              var jshost = c.newObject(s);
              jshost.put("type", jshost, host.type());
              if (host.value() != null) {
                // Store numbers as JS numbers so they compare/concatenate
                // natively (serializeHost recovers the 32-bit pattern via ToInt32).
                Object value = host.value() instanceof Number n ? n.doubleValue() : host.value();
                jshost.put("value", jshost, value);
              }
              if (host.pieces() != null) {
                Object[] arr = new Object[host.pieces().length];
                for (int i = 0; i < host.pieces().length; i++) {
                  arr[i] = (double) host.pieces()[i];
                }
                jshost.put("pieces", jshost, c.newArray(s, arr));
              }
              return jshost;
            }));
    o.put("serializeHost", o, new LambdaFunction(scope, "serializeHost", 1, Url::serializeHost));
    o.put(
        "urlencodedParse",
        o,
        new LambdaFunction(
            scope,
            "urlencodedParse",
            1,
            (Context c, VarScope s, Object self, Object[] args) ->
                Percent.urlencodedParse(c, s, Context.toString(args[0]))));
    o.put(
        "urlencodedSerialize",
        o,
        new LambdaFunction(scope, "urlencodedSerialize", 1, Url::urlencodedSerialize));
    o.put("toUSVString", o, new LambdaFunction(scope, "toUSVString", 1, Url::toUSVString));
    o.put(
        "codePoints",
        o,
        new LambdaFunction(
            scope,
            "codePoints",
            1,
            (Context c, VarScope s, Object self, Object[] args) ->
                Strings.codePoints(c, s, Context.toString(args[0]))));
    return o;
  }

  private static Object percentEncode(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 2) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    return Percent.percentEncode(Context.toString(args[0]), Context.toString(args[1]));
  }

  private static Object serializeHost(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    return Hosts.serializeHost(scope, args[0]);
  }

  private static Object urlencodedSerialize(
      Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    return Percent.urlencodedSerialize(args[0]);
  }

  private static Object toUSVString(Context cx, VarScope scope, Object self, Object[] args) {
    if (args.length < 1) {
      throw ScriptRuntime.typeError("Not enough arguments");
    }
    return Strings.toUSVString(Context.toString(args[0]));
  }
}
