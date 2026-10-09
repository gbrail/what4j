// URLPattern implementation for Rhino.
//
// This module depends on globals provided by core/scripts/url.js, which must be
// loaded first. It intentionally avoids `class`, `async`/`await`, and generators.

var UP_COMPONENTS = [
  "protocol",
  "username",
  "password",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
];

var UP_ID_START_RE = new RegExp("\\p{ID_Start}", "u");
var UP_ID_CONTINUE_RE = new RegExp("\\p{ID_Continue}", "u");

// ---------------------------------------------------------------------------
// Code point helpers
// ---------------------------------------------------------------------------

function upCodePointLength(str) {
  return codePoints(str).length;
}

function upCodePointAt(str, index) {
  var cps = codePoints(str);
  return index >= 0 && index < cps.length ? cps[index] : undefined;
}

function upCodePointSubstring(str, start, end) {
  var cps = codePoints(str);
  if (start < 0) start = 0;
  if (end > cps.length) end = cps.length;
  var out = "";
  for (var i = start; i < end; i++) {
    out += fromCodePoint(cps[i]);
  }
  return out;
}

function upCodePointSubstringToEnd(str, start) {
  return upCodePointSubstring(str, start, upCodePointLength(str));
}

function upLastIndexOfCodePoint(str, cp) {
  var cps = codePoints(str);
  for (var i = cps.length - 1; i >= 0; i--) {
    if (cps[i] === cp) return i;
  }
  return null;
}

function upCodePointEquals(cp, str) {
  if (str.length === 0) return false;
  var cps = codePoints(str);
  return cps.length === 1 && cps[0] === cp;
}

// ---------------------------------------------------------------------------
// Identifier helpers
// ---------------------------------------------------------------------------

function upIsIdentifierStart(cp) {
  if (cp === 0x24 || cp === 0x5f) return true;
  if (cp === 0x200c || cp === 0x200d) return false;
  return UP_ID_START_RE.test(fromCodePoint(cp));
}

function upIsIdentifierPart(cp) {
  if (cp === 0x24 || cp === 0x5f || cp === 0x200c || cp === 0x200d) return true;
  return UP_ID_CONTINUE_RE.test(fromCodePoint(cp));
}

function upIsValidNameCodePoint(cp, first) {
  if (cp === undefined) return false;
  return first ? upIsIdentifierStart(cp) : upIsIdentifierPart(cp);
}

// ---------------------------------------------------------------------------
// Escape helpers
// ---------------------------------------------------------------------------

function upEscapeRegExpString(input) {
  var out = "";
  for (var i = 0; i < input.length; i++) {
    var c = input.charAt(i);
    if (
      c === "." ||
      c === "+" ||
      c === "*" ||
      c === "?" ||
      c === "^" ||
      c === "$" ||
      c === "{" ||
      c === "}" ||
      c === "(" ||
      c === ")" ||
      c === "[" ||
      c === "]" ||
      c === "|" ||
      c === "/" ||
      c === "\\"
    ) {
      out += "\\";
    }
    out += c;
  }
  return out;
}

function upEscapePatternString(input) {
  var out = "";
  for (var i = 0; i < input.length; i++) {
    var c = input.charAt(i);
    if (
      c === "+" ||
      c === "*" ||
      c === "?" ||
      c === ":" ||
      c === "{" ||
      c === "}" ||
      c === "(" ||
      c === ")" ||
      c === "\\"
    ) {
      out += "\\";
    }
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------

function upTokenize(input, policy) {
  var cps = codePoints(input);
  var tokens = [];
  var i = 0;

  function addToken(type, nextPosition, valuePosition, valueLength) {
    addTokenAt(type, i, nextPosition, valuePosition, valueLength);
  }

  function addTokenAt(type, tokenIndex, nextPosition, valuePosition, valueLength) {
    tokens.push({
      type: type,
      index: tokenIndex,
      value: upCodePointSubstring(input, valuePosition, valuePosition + valueLength),
    });
    i = nextPosition;
  }

  function addTokenWithDefaultLength(type, nextPosition, valuePosition) {
    addToken(type, nextPosition, valuePosition, nextPosition - valuePosition);
  }

  function addTokenWithDefaultPositionAndLength(type) {
    addTokenWithDefaultLength(type, i + 1, i);
  }

  function processTokenizingError(nextPosition, valuePosition) {
    if (policy === "strict") {
      throw new TypeError("Invalid pattern string");
    }
    addTokenWithDefaultLength("invalid-char", nextPosition, valuePosition);
  }

  while (i < cps.length) {
    var cp = cps[i];

    if (cp === 0x2a) {
      addTokenWithDefaultPositionAndLength("asterisk");
      continue;
    }

    if (cp === 0x2b || cp === 0x3f) {
      addTokenWithDefaultPositionAndLength("other-modifier");
      continue;
    }

    if (cp === 0x5c) {
      if (i === cps.length - 1) {
        processTokenizingError(i + 1, i);
        continue;
      }
      var escapedIndex = i + 1;
      addTokenAt("escaped-char", i, i + 2, escapedIndex, 1);
      continue;
    }

    if (cp === 0x7b) {
      addTokenWithDefaultPositionAndLength("open");
      continue;
    }

    if (cp === 0x7d) {
      addTokenWithDefaultPositionAndLength("close");
      continue;
    }

    if (cp === 0x3a) {
      var namePosition = i + 1;
      var nameStart = i + 1;
      while (namePosition < cps.length) {
        var first = namePosition === nameStart;
        if (!upIsValidNameCodePoint(cps[namePosition], first)) break;
        namePosition++;
      }
      if (namePosition <= nameStart) {
        processTokenizingError(nameStart, i);
        continue;
      }
      addToken("name", namePosition, nameStart, namePosition - nameStart);
      continue;
    }

    if (cp === 0x28) {
      var depth = 1;
      var regexpPosition = i + 1;
      var regexpStart = i + 1;
      var error = false;

      while (regexpPosition < cps.length) {
        var rcp = cps[regexpPosition];

        if (rcp > 0x7f) {
          processTokenizingError(regexpStart, i);
          error = true;
          break;
        }

        if (regexpPosition === regexpStart && rcp === 0x3f) {
          processTokenizingError(regexpStart, i);
          error = true;
          break;
        }

        if (rcp === 0x5c) {
          if (regexpPosition === cps.length - 1) {
            processTokenizingError(regexpStart, i);
            error = true;
            break;
          }
          if (cps[regexpPosition + 1] > 0x7f) {
            processTokenizingError(regexpStart, i);
            error = true;
            break;
          }
          regexpPosition = regexpPosition + 2;
          continue;
        }

        if (rcp === 0x29) {
          depth--;
          if (depth === 0) {
            regexpPosition++;
            break;
          }
        } else if (rcp === 0x28) {
          depth++;
          if (regexpPosition === cps.length - 1) {
            processTokenizingError(regexpStart, i);
            error = true;
            break;
          }
          if (cps[regexpPosition + 1] !== 0x3f) {
            processTokenizingError(regexpStart, i);
            error = true;
            break;
          }
        }

        regexpPosition++;
      }

      if (error) continue;
      if (depth !== 0) {
        processTokenizingError(regexpStart, i);
        continue;
      }

      var regexpLength = regexpPosition - regexpStart - 1;
      if (regexpLength === 0) {
        processTokenizingError(regexpStart, i);
        continue;
      }

      addToken("regexp", regexpPosition, regexpStart, regexpLength);
      continue;
    }

    addTokenWithDefaultPositionAndLength("char");
  }

  tokens.push({ type: "end", index: i, value: "" });
  return tokens;
}

// ---------------------------------------------------------------------------
// Pattern string parsing
// ---------------------------------------------------------------------------

function upDefaultOptions() {
  return { delimiterCodePoint: "", prefixCodePoint: "", ignoreCase: false };
}

function upHostnameOptions() {
  return { delimiterCodePoint: ".", prefixCodePoint: "", ignoreCase: false };
}

function upPathnameOptions() {
  return { delimiterCodePoint: "/", prefixCodePoint: "/", ignoreCase: false };
}

function upGenerateSegmentWildcardRegexp(options) {
  return "[^" + upEscapeRegExpString(options.delimiterCodePoint) + "]+?";
}

function upTryConsumeToken(parser, type) {
  if (parser.index >= parser.tokens.length) return null;
  var token = parser.tokens[parser.index];
  if (token.type !== type) return null;
  parser.index++;
  return token;
}

function upTryConsumeModifierToken(parser) {
  var token = upTryConsumeToken(parser, "other-modifier");
  if (token !== null) return token;
  return upTryConsumeToken(parser, "asterisk");
}

function upTryConsumeRegexpOrWildcardToken(parser, nameToken) {
  var token = upTryConsumeToken(parser, "regexp");
  if (nameToken === null && token === null) {
    token = upTryConsumeToken(parser, "asterisk");
  }
  return token;
}

function upConsumeRequiredToken(parser, type) {
  var result = upTryConsumeToken(parser, type);
  if (result === null) throw new TypeError("Invalid pattern string");
  return result;
}

function upConsumeText(parser) {
  var result = "";
  for (;;) {
    var token = upTryConsumeToken(parser, "char");
    if (token === null) token = upTryConsumeToken(parser, "escaped-char");
    if (token === null) break;
    result += token.value;
  }
  return result;
}

function upMaybeAddPartFromPendingFixedValue(parser) {
  if (parser.pendingFixed === "") return;
  var encoded = parser.encodingCallback(parser.pendingFixed);
  parser.pendingFixed = "";
  parser.partList.push({
    type: "fixed-text",
    value: encoded,
    modifier: "none",
    name: "",
    prefix: "",
    suffix: "",
  });
}

function upIsDuplicateName(parser, name) {
  for (var i = 0; i < parser.partList.length; i++) {
    if (parser.partList[i].name === name) return true;
  }
  return false;
}

function upAddPart(parser, prefix, nameToken, regexpOrWildcardToken, suffix, modifierToken) {
  var modifier = "none";
  if (modifierToken !== null) {
    if (modifierToken.value === "?") modifier = "optional";
    else if (modifierToken.value === "*") modifier = "zero-or-more";
    else if (modifierToken.value === "+") modifier = "one-or-more";
  }

  if (nameToken === null && regexpOrWildcardToken === null && modifier === "none") {
    parser.pendingFixed += prefix;
    return;
  }

  upMaybeAddPartFromPendingFixedValue(parser);

  if (nameToken === null && regexpOrWildcardToken === null) {
    if (prefix === "") return;
    var encodedPrefix = parser.encodingCallback(prefix);
    parser.partList.push({
      type: "fixed-text",
      value: encodedPrefix,
      modifier: modifier,
      name: "",
      prefix: "",
      suffix: "",
    });
    return;
  }

  var regexpValue;
  if (regexpOrWildcardToken === null) {
    regexpValue = parser.segmentWildcardRegexp;
  } else if (regexpOrWildcardToken.type === "asterisk") {
    regexpValue = ".*";
  } else {
    regexpValue = regexpOrWildcardToken.value;
  }

  var type = "regexp";
  if (regexpValue === parser.segmentWildcardRegexp) {
    type = "segment-wildcard";
    regexpValue = "";
  } else if (regexpValue === ".*") {
    type = "full-wildcard";
    regexpValue = "";
  }

  var name = "";
  if (nameToken !== null) {
    name = nameToken.value;
  } else if (regexpOrWildcardToken !== null) {
    name = String(parser.nextNumericName);
    parser.nextNumericName++;
  }

  if (upIsDuplicateName(parser, name)) {
    throw new TypeError("Duplicate pattern group name");
  }

  var encodedPrefix = parser.encodingCallback(prefix);
  var encodedSuffix = parser.encodingCallback(suffix);

  parser.partList.push({
    type: type,
    value: regexpValue,
    modifier: modifier,
    name: name,
    prefix: encodedPrefix,
    suffix: encodedSuffix,
  });
}

function upParsePatternString(input, options, encodingCallback) {
  var tokens = upTokenize(input, "strict");
  var parser = {
    tokens: tokens,
    index: 0,
    pendingFixed: "",
    partList: [],
    nextNumericName: 0,
    segmentWildcardRegexp: upGenerateSegmentWildcardRegexp(options),
    encodingCallback: encodingCallback,
  };

  while (parser.index < parser.tokens.length) {
    var charToken = upTryConsumeToken(parser, "char");
    var nameToken = upTryConsumeToken(parser, "name");
    var regexpOrWildcardToken = upTryConsumeRegexpOrWildcardToken(
      parser,
      nameToken
    );

    if (nameToken !== null || regexpOrWildcardToken !== null) {
      var prefix = "";
      if (charToken !== null) prefix = charToken.value;
      if (prefix !== "" && prefix !== options.prefixCodePoint) {
        parser.pendingFixed += prefix;
        prefix = "";
      }
      upMaybeAddPartFromPendingFixedValue(parser);
      var modifierToken = upTryConsumeModifierToken(parser);
      upAddPart(parser, prefix, nameToken, regexpOrWildcardToken, "", modifierToken);
      continue;
    }

    var fixedToken = charToken;
    if (fixedToken === null) {
      fixedToken = upTryConsumeToken(parser, "escaped-char");
    }
    if (fixedToken !== null) {
      parser.pendingFixed += fixedToken.value;
      continue;
    }

    var openToken = upTryConsumeToken(parser, "open");
    if (openToken !== null) {
      var groupPrefix = upConsumeText(parser);
      var groupNameToken = upTryConsumeToken(parser, "name");
      var groupRegexpOrWildcardToken = upTryConsumeRegexpOrWildcardToken(
        parser,
        groupNameToken
      );
      var groupSuffix = upConsumeText(parser);
      upConsumeRequiredToken(parser, "close");
      var groupModifierToken = upTryConsumeModifierToken(parser);
      upAddPart(
        parser,
        groupPrefix,
        groupNameToken,
        groupRegexpOrWildcardToken,
        groupSuffix,
        groupModifierToken
      );
      continue;
    }

    upMaybeAddPartFromPendingFixedValue(parser);
    upConsumeRequiredToken(parser, "end");
  }

  return parser.partList;
}

// ---------------------------------------------------------------------------
// Regexp generation
// ---------------------------------------------------------------------------

function upSanitizeCustomRegexp(input) {
  var cps = codePoints(input);
  var out = "";
  var i = 0;
  var inClass = false;

  while (i < cps.length) {
    var cp = cps[i];

    if (cp === 0x5c) {
      if (i + 1 < cps.length) {
        out += fromCodePoint(cp) + fromCodePoint(cps[i + 1]);
        i += 2;
      } else {
        out += fromCodePoint(cp);
        i += 1;
      }
      continue;
    }

    if (!inClass && cp === 0x5b) {
      inClass = true;
      out += fromCodePoint(cp);
      i++;
      continue;
    }

    if (inClass && cp === 0x5d) {
      inClass = false;
      out += fromCodePoint(cp);
      i++;
      continue;
    }

    if (!inClass && cp === 0x28) {
      if (i + 1 < cps.length && cps[i + 1] === 0x3f) {
        var next = i + 2 < cps.length ? cps[i + 2] : EOF;
        if (next === 0x3d || next === 0x21) {
          out += "(?" + fromCodePoint(next);
          i += 3;
          continue;
        }
        if (next === 0x3a) {
          out += "(?:";
          i += 3;
          continue;
        }
        if (next === 0x3c) {
          var after = i + 3 < cps.length ? cps[i + 3] : EOF;
          if (after === 0x3d || after === 0x21) {
            out += "(?<" + fromCodePoint(after);
            i += 4;
            continue;
          }
          if (upIsIdentifierStart(after)) {
            var j = i + 3;
            while (j < cps.length) {
              var c = cps[j];
              if (c === 0x3e) break;
              if (!upIsIdentifierPart(c)) break;
              j++;
            }
            if (j < cps.length && cps[j] === 0x3e) {
              out += "(?:";
              i = j + 1;
              continue;
            }
          }
        }
      } else {
        out += "(?:";
        i += 1;
        continue;
      }
    }

    out += fromCodePoint(cp);
    i++;
  }

  return out;
}

function upClassHasSetOperation(inner) {
  var i = 0;
  if (i < inner.length && inner.charAt(i) === "^") i++;
  if (i < inner.length && inner.charAt(i) === "]") i++;
  var depth = 0;
  while (i < inner.length) {
    var c = inner.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") {
      depth++;
    } else if (c === "]") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      if (inner.substr(i, 2) === "--" || inner.substr(i, 2) === "&&") {
        return true;
      }
    }
    i++;
  }
  return false;
}

function upNewClassSet() {
  var set = [];
  for (var i = 0; i < 128; i++) set.push(false);
  return set;
}

function upClassSetFromChar(set, ch) {
  var code = ch.charCodeAt(0);
  if (code >= 0 && code < 128) set[code] = true;
  return set;
}

function upClassSetFromRange(set, a, b) {
  var start = a.charCodeAt(0);
  var end = b.charCodeAt(0);
  if (start > end) {
    var t = start;
    start = end;
    end = t;
  }
  for (var i = start; i <= end && i < 128; i++) set[i] = true;
  return set;
}

function upClassSetDifference(a, b) {
  var out = upNewClassSet();
  for (var i = 0; i < 128; i++) out[i] = a[i] && !b[i];
  return out;
}

function upClassSetIntersection(a, b) {
  var out = upNewClassSet();
  for (var i = 0; i < 128; i++) out[i] = a[i] && b[i];
  return out;
}

function upEscapeClassChar(ch) {
  if (ch === "]" || ch === "\\" || ch === "-") return "\\" + ch;
  return ch;
}

function upClassSetToString(set) {
  var out = "";
  var i = 0;
  while (i < 128) {
    if (!set[i]) {
      i++;
      continue;
    }
    var start = i;
    while (i < 128 && set[i]) i++;
    var end = i - 1;
    if (start === end) {
      out += upEscapeClassChar(String.fromCharCode(start));
    } else {
      out +=
        upEscapeClassChar(String.fromCharCode(start)) +
        "-" +
        upEscapeClassChar(String.fromCharCode(end));
    }
  }
  if (out === "") throw new TypeError("Invalid regular expression");
  return out;
}

function upClassFindMatchingClose(inner) {
  var i = 0;
  if (i < inner.length && inner.charAt(i) === "^") i++;
  if (i < inner.length && inner.charAt(i) === "]") i++;
  var depth = 1;
  while (i < inner.length) {
    var c = inner.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function upClassReadChar(s, pos) {
  if (pos >= s.length) return { ch: null, pos: pos };
  if (s.charAt(pos) === "\\") {
    if (pos + 1 >= s.length) return { ch: null, pos: pos + 1 };
    return { ch: s.charAt(pos + 1), pos: pos + 2 };
  }
  return { ch: s.charAt(pos), pos: pos + 1 };
}

function upClassOperandToSet(s, pos) {
  if (pos >= s.length) throw new TypeError("Invalid regular expression");

  if (s.charAt(pos) === "[") {
    var end = upClassFindMatchingClose(s.substring(pos + 1));
    if (end === -1) throw new TypeError("Invalid regular expression");
    var inner = s.substring(pos + 1, pos + 1 + end);
    return { set: upClassInnerToSet(inner), pos: pos + 2 + end };
  }

  if (s.charAt(pos) === "\\") {
    if (pos + 1 >= s.length) throw new TypeError("Invalid regular expression");
    var next = s.charAt(pos + 1);
    if (next === "d") {
      var set = upNewClassSet();
      for (var d = 48; d <= 57; d++) set[d] = true;
      return { set: set, pos: pos + 2 };
    }
    var single = upClassReadChar(s, pos);
    return { set: upClassSetFromChar(upNewClassSet(), single.ch), pos: single.pos };
  }

  var start = upClassReadChar(s, pos);
  var set2 = upNewClassSet();
  upClassSetFromChar(set2, start.ch);
  pos = start.pos;

  if (
    pos + 1 < s.length &&
    s.charAt(pos) === "-" &&
    pos + 2 < s.length &&
    s.charAt(pos + 2) !== "]"
  ) {
    var endChar = upClassReadChar(s, pos + 2);
    upClassSetFromRange(set2, start.ch, endChar.ch);
    pos = endChar.pos;
  }

  return { set: set2, pos: pos };
}

function upClassParseExpressionHelper(s, pos) {
  var first = upClassOperandToSet(s, pos);
  var left = first.set;
  pos = first.pos;
  for (;;) {
    if (s.substr(pos, 2) === "--") {
      var right = upClassOperandToSet(s, pos + 2);
      left = upClassSetDifference(left, right.set);
      pos = right.pos;
    } else if (s.substr(pos, 2) === "&&") {
      var right2 = upClassOperandToSet(s, pos + 2);
      left = upClassSetIntersection(left, right2.set);
      pos = right2.pos;
    } else {
      break;
    }
  }
  return { set: left, pos: pos };
}

function upClassInnerToSet(inner) {
  if (!upClassHasSetOperation(inner)) {
    var plain = upNewClassSet();
    var i = 0;
    if (i < inner.length && inner.charAt(i) === "^") i++;
    if (i < inner.length && inner.charAt(i) === "]") i++;
    while (i < inner.length) {
      if (inner.charAt(i) === "\\") {
        if (i + 1 >= inner.length) break;
        var esc = inner.charAt(i + 1);
        upClassSetFromChar(plain, esc);
        i += 2;
        continue;
      }
      var ch = inner.charAt(i);
      if (i + 2 < inner.length && inner.charAt(i + 1) === "-" && inner.charAt(i + 2) !== "]") {
        var endCh = inner.charAt(i + 2);
        upClassSetFromRange(plain, ch, endCh);
        i += 3;
        continue;
      }
      upClassSetFromChar(plain, ch);
      i++;
    }
    return plain;
  }

  var parsed = upClassParseExpressionHelper(inner, 0);
  if (parsed.pos !== inner.length) {
    throw new TypeError("Invalid regular expression");
  }
  return parsed.set;
}

function upTranslateClass(inner) {
  if (!upClassHasSetOperation(inner)) return inner;
  return upClassSetToString(upClassInnerToSet(inner));
}

function upTranslateVToU(input) {
  var out = "";
  var i = 0;
  while (i < input.length) {
    var c = input.charAt(i);
    if (c === "\\" && i + 1 < input.length) {
      out += c + input.charAt(i + 1);
      i += 2;
      continue;
    }
    if (c === "[") {
      var j = i + 1;
      if (j < input.length && input.charAt(j) === "^") j++;
      if (j < input.length && input.charAt(j) === "]") j++;
      var depth = 1;
      while (j < input.length) {
        var cj = input.charAt(j);
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === "[") depth++;
        else if (cj === "]") {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (j >= input.length) {
        out += c;
        i++;
        continue;
      }
      var inner = input.substring(i + 1, j);
      out += "[" + upTranslateClass(inner) + "]";
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function upCreateRegExp(pattern, ignoreCase) {
  var flags = ignoreCase ? "iu" : "u";
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    throw new TypeError("Invalid regular expression");
  }
}

function upConvertModifierToRegExpString(modifier) {
  if (modifier === "zero-or-more") return "*";
  if (modifier === "optional") return "?";
  if (modifier === "one-or-more") return "+";
  return "";
}

function upGenerateRegexpAndNameList(partList, options) {
  var result = "^";
  var nameList = [];

  for (var i = 0; i < partList.length; i++) {
    var part = partList[i];

    if (part.type === "fixed-text") {
      if (part.modifier === "none") {
        result += upEscapeRegExpString(part.value);
      } else {
        result +=
          "(?:" +
          upEscapeRegExpString(part.value) +
          ")" +
          upConvertModifierToRegExpString(part.modifier);
      }
      continue;
    }

    nameList.push(part.name);

    var regexpValue;
    if (part.type === "segment-wildcard") {
      regexpValue = upGenerateSegmentWildcardRegexp(options);
    } else if (part.type === "full-wildcard") {
      regexpValue = ".*";
    } else {
      regexpValue = upTranslateVToU(upSanitizeCustomRegexp(part.value));
    }

    if (part.prefix === "" && part.suffix === "") {
      if (part.modifier === "none" || part.modifier === "optional") {
        result +=
          "(" + regexpValue + ")" + upConvertModifierToRegExpString(part.modifier);
      } else {
        result +=
          "((?:" +
          regexpValue +
          ")" +
          upConvertModifierToRegExpString(part.modifier) +
          ")";
      }
      continue;
    }

    if (part.modifier === "none" || part.modifier === "optional") {
      result +=
        "(?:" +
        upEscapeRegExpString(part.prefix) +
        "(" +
        regexpValue +
        ")" +
        upEscapeRegExpString(part.suffix) +
        ")" +
        upConvertModifierToRegExpString(part.modifier);
      continue;
    }

    result +=
      "(?:" +
      upEscapeRegExpString(part.prefix) +
      "((?:" +
      regexpValue +
      ")(?:" +
      upEscapeRegExpString(part.suffix) +
      upEscapeRegExpString(part.prefix) +
      "(?:" +
      regexpValue +
      "))*)" +
      upEscapeRegExpString(part.suffix) +
      ")";
    if (part.modifier === "zero-or-more") result += "?";
  }

  result += "$";
  return { regexp: result, nameList: nameList };
}

// ---------------------------------------------------------------------------
// Pattern string generation
// ---------------------------------------------------------------------------

function upConvertModifierToString(modifier) {
  if (modifier === "zero-or-more") return "*";
  if (modifier === "optional") return "?";
  if (modifier === "one-or-more") return "+";
  return "";
}

function upGeneratePatternString(partList, options) {
  var result = "";

  for (var i = 0; i < partList.length; i++) {
    var part = partList[i];
    var prev = i > 0 ? partList[i - 1] : null;
    var next = i < partList.length - 1 ? partList[i + 1] : null;

    if (part.type === "fixed-text") {
      if (part.modifier === "none") {
        result += upEscapePatternString(part.value);
        continue;
      }
      result +=
        "{" +
        upEscapePatternString(part.value) +
        "}" +
        upConvertModifierToString(part.modifier);
      continue;
    }

    var customName = !isASCIIDigit(upCodePointAt(part.name, 0));
    var needsGrouping = false;

    if (part.suffix !== "") needsGrouping = true;
    if (part.prefix !== "" && part.prefix !== options.prefixCodePoint) {
      needsGrouping = true;
    }

    if (
      !needsGrouping &&
      customName &&
      part.type === "segment-wildcard" &&
      part.modifier === "none" &&
      next !== null &&
      next.prefix === "" &&
      next.suffix === ""
    ) {
      if (next.type === "fixed-text") {
        if (upIsValidNameCodePoint(upCodePointAt(next.value, 0), false)) {
          needsGrouping = true;
        }
      } else {
        if (isASCIIDigit(upCodePointAt(next.name, 0))) needsGrouping = true;
      }
    }

    if (!needsGrouping && part.prefix === "" && prev !== null && prev.type === "fixed-text") {
      var prevLast = upCodePointAt(prev.value, upCodePointLength(prev.value) - 1);
      if (upCodePointEquals(prevLast, options.prefixCodePoint)) {
        needsGrouping = true;
      }
    }

    if (needsGrouping) result += "{";
    result += upEscapePatternString(part.prefix);

    if (customName) {
      result += ":" + part.name;
    }

    if (part.type === "regexp") {
      result += "(" + part.value + ")";
    } else if (part.type === "segment-wildcard" && !customName) {
      result += "(" + upGenerateSegmentWildcardRegexp(options) + ")";
    } else if (part.type === "full-wildcard") {
      var useAsterisk =
        !customName &&
        (prev === null ||
          prev.type === "fixed-text" ||
          prev.modifier !== "none" ||
          needsGrouping ||
          part.prefix !== "");
      if (useAsterisk) {
        result += "*";
      } else {
        result += "(.*)";
      }
    }

    if (part.type === "segment-wildcard" && customName && part.suffix !== "") {
      if (upIsValidNameCodePoint(upCodePointAt(part.suffix, 0), false)) {
        result += "\\";
      }
    }

    result += upEscapePatternString(part.suffix);

    if (needsGrouping) result += "}";
    result += upConvertModifierToString(part.modifier);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

function upCreateDummyURL() {
  return basicURLParser("https://dummy.invalid/", null, null, null);
}

function upCanonicalizeProtocol(value) {
  if (value === "") return "";
  var parsed = basicURLParser(value + "://dummy.invalid/", null, null, null);
  if (!parsed) throw new TypeError("Invalid protocol");
  return parsed.scheme;
}

function upCanonicalizeUsername(value) {
  if (value === "") return "";
  return utf8PercentEncodeString(value, userinfoSet);
}

function upCanonicalizePassword(value) {
  if (value === "") return "";
  return utf8PercentEncodeString(value, userinfoSet);
}

function upCanonicalizeHostname(value) {
  if (value === "") return "";
  var dummy = upCreateDummyURL();
  var parsed = basicURLParser(value, null, dummy, HOSTNAME);
  if (!parsed) throw new TypeError("Invalid hostname");
  return parsed.host ? serializeHost(parsed.host) : "";
}

function upCanonicalizeIPv6Hostname(value) {
  var cps = codePoints(value);
  for (var i = 0; i < cps.length; i++) {
    var cp = cps[i];
    if (
      !isASCIIHexDigit(cp) &&
      cp !== 0x5b &&
      cp !== 0x5d &&
      cp !== 0x3a
    ) {
      throw new TypeError("Invalid IPv6 hostname");
    }
  }
  return asciiLowercase(value);
}

function upCanonicalizePort(value, protocolValue) {
  if (value === "") return "";
  var dummy = upCreateDummyURL();
  dummy.scheme = protocolValue ? protocolValue : "";
  var parsed = basicURLParser(value, null, dummy, PORT);
  if (!parsed) throw new TypeError("Invalid port");
  return parsed.port === null ? "" : String(parsed.port);
}

function upCanonicalizePathname(value) {
  if (value === "") return "";
  var leadingSlash = upCodePointAt(value, 0) === 0x2f;
  var modified = leadingSlash ? "" : "/-";
  modified += value;
  var dummy = upCreateDummyURL();
  dummy.path = [];
  basicURLParser(modified, null, dummy, PATH_START);
  var result = serializeURLPath(dummy);
  if (!leadingSlash) result = upCodePointSubstringToEnd(result, 2);
  return result;
}

function upCanonicalizeOpaquePathname(value) {
  if (value === "") return "";
  var dummy = upCreateDummyURL();
  dummy.path = "";
  var parsed = basicURLParser(value, null, dummy, CANNOT_BE_BASE);
  if (!parsed) throw new TypeError("Invalid opaque pathname");
  return serializeURLPath(dummy);
}

function upCanonicalizeSearch(value) {
  if (value === "") return "";
  var dummy = upCreateDummyURL();
  dummy.query = "";
  basicURLParser(value, null, dummy, QUERY);
  return dummy.query;
}

function upCanonicalizeHash(value) {
  if (value === "") return "";
  var dummy = upCreateDummyURL();
  dummy.fragment = "";
  basicURLParser(value, null, dummy, FRAGMENT);
  return dummy.fragment;
}

// ---------------------------------------------------------------------------
// URLPatternInit processing
// ---------------------------------------------------------------------------

function upHas(obj, key) {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === "object" &&
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

function upProcessBaseString(input, type) {
  var str = String(input);
  if (type !== "pattern") return str;
  return upEscapePatternString(str);
}

function upStripTrailingColon(value) {
  var cps = codePoints(value);
  if (cps.length > 0 && cps[cps.length - 1] === 0x3a) {
    return upCodePointSubstring(value, 0, cps.length - 1);
  }
  return value;
}

function upStripLeadingCodePoint(value, cp) {
  if (upCodePointAt(value, 0) === cp) {
    return upCodePointSubstringToEnd(value, 1);
  }
  return value;
}

function upProcessProtocolForInit(value, type) {
  var stripped = upStripTrailingColon(value);
  if (type === "pattern") return stripped;
  return upCanonicalizeProtocol(stripped);
}

function upProcessUsernameForInit(value, type) {
  if (type === "pattern") return value;
  return upCanonicalizeUsername(value);
}

function upProcessPasswordForInit(value, type) {
  if (type === "pattern") return value;
  return upCanonicalizePassword(value);
}

function upProcessHostnameForInit(value, type) {
  if (type === "pattern") return value;
  return upCanonicalizeHostname(value);
}

function upProcessPortForInit(portValue, protocolValue, type) {
  if (type === "pattern") return portValue;
  return upCanonicalizePort(portValue, protocolValue);
}

function upProcessPathnameForInit(pathnameValue, protocolValue, type) {
  if (type === "pattern") return pathnameValue;
  if (protocolValue === "" || isSpecialScheme(protocolValue)) {
    return upCanonicalizePathname(pathnameValue);
  }
  return upCanonicalizeOpaquePathname(pathnameValue);
}

function upProcessSearchForInit(value, type) {
  var stripped = upStripLeadingCodePoint(value, 0x3f);
  if (type === "pattern") return stripped;
  return upCanonicalizeSearch(stripped);
}

function upProcessHashForInit(value, type) {
  var stripped = upStripLeadingCodePoint(value, 0x23);
  if (type === "pattern") return stripped;
  return upCanonicalizeHash(stripped);
}

function upIsAbsolutePathname(input, type) {
  if (input === "") return false;
  var cps = codePoints(input);
  if (cps[0] === 0x2f) return true;
  if (type === "url") return false;
  if (cps.length < 2) return false;
  if (cps[0] === 0x5c && cps[1] === 0x2f) return true;
  if (cps[0] === 0x7b && cps[1] === 0x2f) return true;
  return false;
}

function upProcessInit(
  init,
  type,
  protocol,
  username,
  password,
  hostname,
  port,
  pathname,
  search,
  hash
) {
  init = init || {};
  var result = {};

  if (protocol !== null && protocol !== undefined) result.protocol = String(protocol);
  if (username !== null && username !== undefined) result.username = String(username);
  if (password !== null && password !== undefined) result.password = String(password);
  if (hostname !== null && hostname !== undefined) result.hostname = String(hostname);
  if (port !== null && port !== undefined) result.port = String(port);
  if (pathname !== null && pathname !== undefined) result.pathname = String(pathname);
  if (search !== null && search !== undefined) result.search = String(search);
  if (hash !== null && hash !== undefined) result.hash = String(hash);

  var baseURL = null;

  if (upHas(init, "baseURL")) {
    var baseStr = String(init.baseURL);
    baseURL = basicURLParser(baseStr, null, null, null);
    if (!baseURL) throw new TypeError("Invalid baseURL");

    if (!upHas(init, "protocol")) {
      result.protocol = upProcessBaseString(baseURL.scheme, type);
    }

    if (
      type !== "pattern" &&
      !upHas(init, "protocol") &&
      !upHas(init, "hostname") &&
      !upHas(init, "port") &&
      !upHas(init, "username")
    ) {
      result.username = upProcessBaseString(baseURL.username, type);
    }

    if (
      type !== "pattern" &&
      !upHas(init, "protocol") &&
      !upHas(init, "hostname") &&
      !upHas(init, "port") &&
      !upHas(init, "username") &&
      !upHas(init, "password")
    ) {
      result.password = upProcessBaseString(baseURL.password, type);
    }

    if (!upHas(init, "protocol") && !upHas(init, "hostname")) {
      var baseHost = baseURL.host ? serializeHost(baseURL.host) : "";
      result.hostname = upProcessBaseString(baseHost, type);
    }

    if (!upHas(init, "protocol") && !upHas(init, "hostname") && !upHas(init, "port")) {
      result.port = baseURL.port === null ? "" : String(baseURL.port);
    }

    if (
      !upHas(init, "protocol") &&
      !upHas(init, "hostname") &&
      !upHas(init, "port") &&
      !upHas(init, "pathname")
    ) {
      result.pathname = upProcessBaseString(serializeURLPath(baseURL), type);
    }

    if (
      !upHas(init, "protocol") &&
      !upHas(init, "hostname") &&
      !upHas(init, "port") &&
      !upHas(init, "pathname") &&
      !upHas(init, "search")
    ) {
      var baseQuery = baseURL.query === null ? "" : baseURL.query;
      result.search = upProcessBaseString(baseQuery, type);
    }

    if (
      !upHas(init, "protocol") &&
      !upHas(init, "hostname") &&
      !upHas(init, "port") &&
      !upHas(init, "pathname") &&
      !upHas(init, "search") &&
      !upHas(init, "hash")
    ) {
      var baseFragment = baseURL.fragment === null ? "" : baseURL.fragment;
      result.hash = upProcessBaseString(baseFragment, type);
    }
  }

  if (upHas(init, "protocol")) {
    result.protocol = upProcessProtocolForInit(String(init.protocol), type);
  }
  if (upHas(init, "username")) {
    result.username = upProcessUsernameForInit(String(init.username), type);
  }
  if (upHas(init, "password")) {
    result.password = upProcessPasswordForInit(String(init.password), type);
  }
  if (upHas(init, "hostname")) {
    result.hostname = upProcessHostnameForInit(String(init.hostname), type);
  }

  var resultProtocolString = upHas(result, "protocol") ? result.protocol : "";

  if (upHas(init, "port")) {
    result.port = upProcessPortForInit(
      String(init.port),
      resultProtocolString,
      type
    );
  }

  if (upHas(init, "pathname")) {
    result.pathname = String(init.pathname);

    if (
      baseURL !== null &&
      !urlHasOpaquePath(baseURL) &&
      !upIsAbsolutePathname(result.pathname, type)
    ) {
      var basePath = upProcessBaseString(serializeURLPath(baseURL), type);
      var slashIndex = upLastIndexOfCodePoint(basePath, 0x2f);
      if (slashIndex !== null) {
        result.pathname =
          upCodePointSubstring(basePath, 0, slashIndex + 1) + result.pathname;
      }
    }

    result.pathname = upProcessPathnameForInit(
      result.pathname,
      resultProtocolString,
      type
    );
  }

  if (upHas(init, "search")) {
    result.search = upProcessSearchForInit(String(init.search), type);
  }
  if (upHas(init, "hash")) {
    result.hash = upProcessHashForInit(String(init.hash), type);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Constructor string parsing
// ---------------------------------------------------------------------------

function upGetSafeToken(parser, index) {
  if (index < parser.tokens.length) return parser.tokens[index];
  return parser.tokens[parser.tokens.length - 1];
}

function upMakeComponentString(parser) {
  var token = parser.tokens[parser.tokenIndex];
  var startToken = upGetSafeToken(parser, parser.componentStart);
  return upCodePointSubstring(parser.input, startToken.index, token.index);
}

function upRewind(parser) {
  parser.tokenIndex = parser.componentStart;
  parser.tokenIncrement = 0;
}

function upRewindAndSetState(parser, state) {
  upRewind(parser);
  parser.state = state;
}

function upChangeState(parser, newState, skip) {
  var oldState = parser.state;

  if (oldState !== "init" && oldState !== "authority" && oldState !== "done") {
    parser.result[oldState] = upMakeComponentString(parser);
  }

  if (oldState !== "init" && newState !== "done") {
    var preHostStates = ["protocol", "authority", "username", "password"];
    var postHostStates = ["port", "pathname", "search", "hash"];
    if (
      preHostStates.indexOf(oldState) !== -1 &&
      postHostStates.indexOf(newState) !== -1 &&
      !upHas(parser.result, "hostname")
    ) {
      parser.result.hostname = "";
    }

    var prePathStates = [
      "protocol",
      "authority",
      "username",
      "password",
      "hostname",
      "port",
    ];
    if (
      prePathStates.indexOf(oldState) !== -1 &&
      (newState === "search" || newState === "hash") &&
      !upHas(parser.result, "pathname")
    ) {
      parser.result.pathname = parser.protocolMatchesSpecialSchemeFlag ? "/" : "";
    }

    var preSearchStates = [
      "protocol",
      "authority",
      "username",
      "password",
      "hostname",
      "port",
      "pathname",
    ];
    if (
      preSearchStates.indexOf(oldState) !== -1 &&
      newState === "hash" &&
      !upHas(parser.result, "search")
    ) {
      parser.result.search = "";
    }
  }

  parser.state = newState;
  parser.tokenIndex += skip;
  parser.componentStart = parser.tokenIndex;
  parser.tokenIncrement = 0;
}

function upIsNonSpecialPatternChar(parser, index, value) {
  var token = upGetSafeToken(parser, index);
  if (token.value !== value) return false;
  return (
    token.type === "char" ||
    token.type === "escaped-char" ||
    token.type === "invalid-char"
  );
}

function upIsProtocolSuffix(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, ":");
}

function upNextIsAuthoritySlashes(parser) {
  return (
    upIsNonSpecialPatternChar(parser, parser.tokenIndex + 1, "/") &&
    upIsNonSpecialPatternChar(parser, parser.tokenIndex + 2, "/")
  );
}

function upIsIdentityTerminator(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, "@");
}

function upIsPasswordPrefix(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, ":");
}

function upIsPortPrefix(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, ":");
}

function upIsPathnameStart(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, "/");
}

function upIsSearchPrefix(parser) {
  if (upIsNonSpecialPatternChar(parser, parser.tokenIndex, "?")) return true;

  var token = parser.tokens[parser.tokenIndex];
  if (!token || token.value !== "?") return false;

  var previousIndex = parser.tokenIndex - 1;
  if (previousIndex < 0) return true;

  var previous = upGetSafeToken(parser, previousIndex);
  if (
    previous.type === "name" ||
    previous.type === "regexp" ||
    previous.type === "close" ||
    previous.type === "asterisk"
  ) {
    return false;
  }
  return true;
}

function upIsHashPrefix(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, "#");
}

function upIsGroupOpen(parser) {
  var token = parser.tokens[parser.tokenIndex];
  return token && token.type === "open";
}

function upIsGroupClose(parser) {
  var token = parser.tokens[parser.tokenIndex];
  return token && token.type === "close";
}

function upIsIPv6Open(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, "[");
}

function upIsIPv6Close(parser) {
  return upIsNonSpecialPatternChar(parser, parser.tokenIndex, "]");
}

function upProtocolComponentMatchesSpecialScheme(component) {
  for (var scheme in SPECIAL_PORTS) {
    if (!Object.prototype.hasOwnProperty.call(SPECIAL_PORTS, scheme)) continue;
    if (component.regexp.exec(scheme) !== null) return true;
  }
  return false;
}

function upComputeProtocolMatchesSpecialSchemeFlag(parser) {
  var protocolString = upMakeComponentString(parser);
  var component = upCompileComponent(
    protocolString,
    upCanonicalizeProtocol,
    upDefaultOptions()
  );
  parser.protocolMatchesSpecialSchemeFlag =
    upProtocolComponentMatchesSpecialScheme(component);
}

function upParseConstructorString(input) {
  var parser = {
    input: input,
    tokens: upTokenize(input, "lenient"),
    result: {},
    componentStart: 0,
    tokenIndex: 0,
    tokenIncrement: 0,
    groupDepth: 0,
    hostnameIPv6BracketDepth: 0,
    protocolMatchesSpecialSchemeFlag: false,
    state: "init",
  };

  while (parser.tokenIndex < parser.tokens.length) {
    parser.tokenIncrement = 1;
    var token = parser.tokens[parser.tokenIndex];

    if (token.type === "end") {
      if (parser.state === "init") {
        upRewind(parser);
        if (upIsHashPrefix(parser)) {
          upChangeState(parser, "hash", 1);
        } else if (upIsSearchPrefix(parser)) {
          upChangeState(parser, "search", 1);
        } else {
          upChangeState(parser, "pathname", 0);
        }
        parser.tokenIndex += parser.tokenIncrement;
        continue;
      }

      if (parser.state === "authority") {
        upRewindAndSetState(parser, "hostname");
        parser.tokenIndex += parser.tokenIncrement;
        continue;
      }

      upChangeState(parser, "done", 0);
      break;
    }

    if (upIsGroupOpen(parser)) {
      parser.groupDepth++;
      parser.tokenIndex += parser.tokenIncrement;
      continue;
    }

    if (parser.groupDepth > 0) {
      if (upIsGroupClose(parser)) {
        parser.groupDepth--;
      } else {
        parser.tokenIndex += parser.tokenIncrement;
        continue;
      }
    }

    switch (parser.state) {
      case "init":
        if (upIsProtocolSuffix(parser)) {
          upRewindAndSetState(parser, "protocol");
        }
        break;

      case "protocol":
        if (upIsProtocolSuffix(parser)) {
          upComputeProtocolMatchesSpecialSchemeFlag(parser);
          var nextState = "pathname";
          var skip = 1;
          if (upNextIsAuthoritySlashes(parser)) {
            nextState = "authority";
            skip = 3;
          } else if (parser.protocolMatchesSpecialSchemeFlag) {
            nextState = "authority";
          }
          upChangeState(parser, nextState, skip);
        }
        break;

      case "authority":
        if (upIsIdentityTerminator(parser)) {
          upRewindAndSetState(parser, "username");
        } else if (
          upIsPathnameStart(parser) ||
          upIsSearchPrefix(parser) ||
          upIsHashPrefix(parser)
        ) {
          upRewindAndSetState(parser, "hostname");
        }
        break;

      case "username":
        if (upIsPasswordPrefix(parser)) {
          upChangeState(parser, "password", 1);
        } else if (upIsIdentityTerminator(parser)) {
          upChangeState(parser, "hostname", 1);
        }
        break;

      case "password":
        if (upIsIdentityTerminator(parser)) {
          upChangeState(parser, "hostname", 1);
        }
        break;

      case "hostname":
        if (upIsIPv6Open(parser)) {
          parser.hostnameIPv6BracketDepth++;
        } else if (upIsIPv6Close(parser)) {
          parser.hostnameIPv6BracketDepth--;
        } else if (
          upIsPortPrefix(parser) &&
          parser.hostnameIPv6BracketDepth === 0
        ) {
          upChangeState(parser, "port", 1);
        } else if (upIsPathnameStart(parser)) {
          upChangeState(parser, "pathname", 0);
        } else if (upIsSearchPrefix(parser)) {
          upChangeState(parser, "search", 1);
        } else if (upIsHashPrefix(parser)) {
          upChangeState(parser, "hash", 1);
        }
        break;

      case "port":
        if (upIsPathnameStart(parser)) {
          upChangeState(parser, "pathname", 0);
        } else if (upIsSearchPrefix(parser)) {
          upChangeState(parser, "search", 1);
        } else if (upIsHashPrefix(parser)) {
          upChangeState(parser, "hash", 1);
        }
        break;

      case "pathname":
        if (upIsSearchPrefix(parser)) {
          upChangeState(parser, "search", 1);
        } else if (upIsHashPrefix(parser)) {
          upChangeState(parser, "hash", 1);
        }
        break;

      case "search":
        if (upIsHashPrefix(parser)) {
          upChangeState(parser, "hash", 1);
        }
        break;

      case "hash":
        break;

      case "done":
        break;
    }

    parser.tokenIndex += parser.tokenIncrement;
  }

  if (upHas(parser.result, "hostname") && !upHas(parser.result, "port")) {
    parser.result.port = "";
  }

  return parser.result;
}

// ---------------------------------------------------------------------------
// Component compilation
// ---------------------------------------------------------------------------

function upCompileComponent(patternString, encodingCallback, options) {
  var partList = upParsePatternString(patternString, options, encodingCallback);
  var generated = upGenerateRegexpAndNameList(partList, options);
  var regexp = upCreateRegExp(generated.regexp, options.ignoreCase);
  var patternStringOut = upGeneratePatternString(partList, options);
  var hasRegExpGroups = false;
  for (var i = 0; i < partList.length; i++) {
    if (partList[i].type === "regexp") hasRegExpGroups = true;
  }
  return {
    patternString: patternStringOut,
    regexp: regexp,
    groupNameList: generated.nameList,
    hasRegExpGroups: hasRegExpGroups,
  };
}

function upHostnamePatternIsIPv6(input) {
  var cps = codePoints(input);
  if (cps.length < 2) return false;
  if (cps[0] === 0x5b) return true;
  if (cps[0] === 0x7b && cps[1] === 0x5b) return true;
  if (cps[0] === 0x5c && cps[1] === 0x5b) return true;
  return false;
}

function upIsURLObject(value) {
  return typeof URL !== "undefined" && value instanceof URL;
}

function upCreate(input, baseURL, options) {
  options = options || {};
  var init;

  if (typeof input === "string") {
    init = upParseConstructorString(input);
    if (baseURL === null && !upHas(init, "protocol")) {
      throw new TypeError("URLPattern constructor: protocol required when no baseURL is given");
    }
    if (baseURL !== null) init.baseURL = baseURL;
  } else {
    if (baseURL !== null) {
      throw new TypeError("URLPattern constructor: baseURL is not supported with URLPatternInit input");
    }
    init = input || {};
  }

  var processedInit = upProcessInit(
    init,
    "pattern",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );

  for (var i = 0; i < UP_COMPONENTS.length; i++) {
    var comp = UP_COMPONENTS[i];
    if (!upHas(processedInit, comp)) processedInit[comp] = "*";
  }

  if (
    isSpecialScheme(processedInit.protocol) &&
    processedInit.port === String(defaultPort(processedInit.protocol))
  ) {
    processedInit.port = "";
  }

  var pattern = {};

  pattern.protocol = upCompileComponent(
    processedInit.protocol,
    upCanonicalizeProtocol,
    upDefaultOptions()
  );
  pattern.username = upCompileComponent(
    processedInit.username,
    upCanonicalizeUsername,
    upDefaultOptions()
  );
  pattern.password = upCompileComponent(
    processedInit.password,
    upCanonicalizePassword,
    upDefaultOptions()
  );

  var hostnameOptions = upHostnameOptions();
  if (upHostnamePatternIsIPv6(processedInit.hostname)) {
    pattern.hostname = upCompileComponent(
      processedInit.hostname,
      upCanonicalizeIPv6Hostname,
      hostnameOptions
    );
  } else {
    pattern.hostname = upCompileComponent(
      processedInit.hostname,
      upCanonicalizeHostname,
      hostnameOptions
    );
  }

  pattern.port = upCompileComponent(
    processedInit.port,
    upCanonicalizePort,
    upDefaultOptions()
  );

  var compileOptions = upDefaultOptions();
  compileOptions.ignoreCase = !!options.ignoreCase;

  if (upProtocolComponentMatchesSpecialScheme(pattern.protocol)) {
    var pathOptions = upPathnameOptions();
    pathOptions.ignoreCase = !!options.ignoreCase;
    pattern.pathname = upCompileComponent(
      processedInit.pathname,
      upCanonicalizePathname,
      pathOptions
    );
  } else {
    pattern.pathname = upCompileComponent(
      processedInit.pathname,
      upCanonicalizeOpaquePathname,
      compileOptions
    );
  }

  pattern.search = upCompileComponent(
    processedInit.search,
    upCanonicalizeSearch,
    compileOptions
  );
  pattern.hash = upCompileComponent(
    processedInit.hash,
    upCanonicalizeHash,
    compileOptions
  );

  pattern.hasRegExpGroups = false;
  for (var j = 0; j < UP_COMPONENTS.length; j++) {
    if (pattern[UP_COMPONENTS[j]].hasRegExpGroups) {
      pattern.hasRegExpGroups = true;
    }
  }

  return pattern;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function upCreateComponentMatchResult(component, input, execResult) {
  var groups = {};
  for (var i = 0; i < component.groupNameList.length; i++) {
    var name = component.groupNameList[i];
    groups[name] = execResult[String(i + 1)];
  }
  return { input: input, groups: groups };
}

function upFillFromURL(url, comp) {
  comp.protocol = url.scheme;
  comp.username = url.username;
  comp.password = url.password;
  comp.hostname = url.host ? serializeHost(url.host) : "";
  comp.port = url.port === null ? "" : String(url.port);
  comp.pathname = serializeURLPath(url);
  comp.search = url.query === null ? "" : url.query;
  comp.hash = url.fragment === null ? "" : url.fragment;
}

function upMatch(urlPattern, input, baseURLString) {
  if (input === undefined || input === null) {
    input = {};
  }
  var inputs = [];
  var comp = {
    protocol: "",
    username: "",
    password: "",
    hostname: "",
    port: "",
    pathname: "",
    search: "",
    hash: "",
  };

  if (upIsURLObject(input)) {
    var serialized = String(input);
    inputs.push(serialized);
    var url = basicURLParser(serialized, null, null, null);
    if (!url) return null;
    upFillFromURL(url, comp);
  } else if (typeof input === "string") {
    inputs.push(input);
    var base = null;
    if (baseURLString !== null) {
      base = basicURLParser(baseURLString, null, null, null);
      if (!base) return null;
      inputs.push(baseURLString);
    }
    var parsed = basicURLParser(input, base, null, null);
    if (!parsed) return null;
    upFillFromURL(parsed, comp);
  } else {
    if (baseURLString !== null) {
      throw new TypeError("URLPattern exec/test: baseURL is not supported with URLPatternInit input");
    }
    inputs.push(input);
    var processed;
    try {
      processed = upProcessInit(
        input,
        "url",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      );
    } catch (e) {
      return null;
    }
    for (var i = 0; i < UP_COMPONENTS.length; i++) {
      var c = UP_COMPONENTS[i];
      comp[c] = upHas(processed, c) ? String(processed[c]) : "";
    }
  }

  var result = { inputs: inputs };

  for (var k = 0; k < UP_COMPONENTS.length; k++) {
    var component = UP_COMPONENTS[k];
    var execResult = urlPattern[component].regexp.exec(comp[component]);
    if (!execResult) return null;
    result[component] = upCreateComponentMatchResult(
      urlPattern[component],
      comp[component],
      execResult
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// URLPattern class
// ---------------------------------------------------------------------------

function URLPattern(input, baseURL, options) {
  if (!(this instanceof URLPattern)) {
    throw new TypeError("URLPattern constructor requires `new`");
  }

  if (upIsURLObject(input) || typeof input === "string") {
    var patternString = String(input);
    var base = null;
    var opts = null;

    if (arguments.length >= 2) {
      if (typeof arguments[1] === "string") {
        base = arguments[1];
        opts = arguments.length >= 3 ? arguments[2] : null;
      } else {
        opts = arguments[1];
      }
    }

    this._up = upCreate(patternString, base, opts);
    return;
  }

  if (arguments.length >= 2 && typeof arguments[1] === "string") {
    throw new TypeError("URLPattern constructor: baseURL is not supported with URLPatternInit input");
  }

  this._up = upCreate(
    input,
    null,
    arguments.length >= 2 ? arguments[1] : null
  );
}

URLPattern.prototype.test = function (input, baseURL) {
  var base =
    baseURL === undefined || baseURL === null ? null : String(baseURL);
  return upMatch(this._up, input, base) !== null;
};

URLPattern.prototype.exec = function (input, baseURL) {
  var base =
    baseURL === undefined || baseURL === null ? null : String(baseURL);
  return upMatch(this._up, input, base);
};

function upDefineComponentGetter(name) {
  Object.defineProperty(URLPattern.prototype, name, {
    get: function () {
      return this._up[name].patternString;
    },
    enumerable: true,
    configurable: true,
  });
}

for (var upDefineIndex = 0; upDefineIndex < UP_COMPONENTS.length; upDefineIndex++) {
  upDefineComponentGetter(UP_COMPONENTS[upDefineIndex]);
}

Object.defineProperty(URLPattern.prototype, "hasRegExpGroups", {
  get: function () {
    return this._up.hasRegExpGroups;
  },
  enumerable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
__loadURLPattern = function (exports) {
  exports.URLPattern = URLPattern;
};
__loadURLPattern
