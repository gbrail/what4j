// WHATWG URL standard implementation (URL + URLSearchParams).
// Runs untranspiled on Rhino: no `class`, no `async`/`await`, `var` + function
// declarations, index-based loops (no `for (const of ...)`), no argument spread.

const icu = getBinding("ICU");
const encoding = getBinding("encoding");

const EOF = -1;

function fromCodePoint(cp) {
  if (cp <= 0xFFFF) return String.fromCharCode(cp);
  cp -= 0x10000;
  return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
}

// Convert a string to an array of code point values.
function codePoints(str) {
  var arr = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      var next = str.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        arr.push(0x10000 + ((c - 0xD800) << 10) + (next - 0xDC00));
        i++;
        continue;
      }
    }
    arr.push(c);
  }
  return arr;
}

function toUSVString(input) {
  var str = String(input);
  var out = "";
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      if (i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += str.charAt(i) + str.charAt(i + 1);
          i++;
          continue;
        }
      }
      out += "\uFFFD";
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      out += "\uFFFD";
    } else {
      out += str.charAt(i);
    }
  }
  return out;
}

function isASCIIAlpha(cp) {
  return (cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A);
}
function isASCIIDigit(cp) {
  return cp >= 0x30 && cp <= 0x39;
}
function isASCIIAlphanumeric(cp) {
  return isASCIIDigit(cp) || isASCIIAlpha(cp);
}
function isASCIIHexDigit(cp) {
  return isASCIIDigit(cp) || (cp >= 0x41 && cp <= 0x46) || (cp >= 0x61 && cp <= 0x66);
}
function isC0ControlOrSpace(cp) {
  return cp <= 0x20;
}
function isASCIITabOrNewline(cp) {
  return cp === 0x09 || cp === 0x0A || cp === 0x0D;
}
function hexValue(cp) {
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  if (cp >= 0x61 && cp <= 0x66) return cp - 0x61 + 10;
  if (cp >= 0x41 && cp <= 0x46) return cp - 0x41 + 10;
  return 0;
}
function isASCIIStr(str) {
  for (var i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7F) return false;
  }
  return true;
}
function asciiLowercase(str) {
  var out = "";
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0x41 && c <= 0x5A) c += 0x20;
    out += String.fromCharCode(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Percent-encoding
// ---------------------------------------------------------------------------
function percentEncodeByte(b) {
  var hex = b.toString(16).toUpperCase();
  if (hex.length < 2) hex = "0" + hex;
  return "%" + hex;
}

function makeSet() {
  var a = [];
  for (var i = 0; i < 256; i++) a[i] = false;
  return a;
}
function copySet(set) {
  var a = [];
  for (var i = 0; i < 256; i++) a[i] = set[i];
  return a;
}
function addRange(set, from, to) {
  for (var i = from; i <= to; i++) set[i] = true;
}
function addEach(set, cps) {
  for (var i = 0; i < cps.length; i++) set[cps[i]] = true;
}

var c0ControlSet = makeSet();
addRange(c0ControlSet, 0x00, 0x1F);
c0ControlSet[0x7F] = true;

var fragmentSet = copySet(c0ControlSet);
addEach(fragmentSet, [0x20, 0x22, 0x3C, 0x3E, 0x60]);

var querySet = copySet(c0ControlSet);
addEach(querySet, [0x20, 0x22, 0x23, 0x3C, 0x3E]);

var specialQuerySet = copySet(querySet);
specialQuerySet[0x27] = true;

var pathSet = copySet(querySet);
addEach(pathSet, [0x3F, 0x5E, 0x60, 0x7B, 0x7D]);

var userinfoSet = copySet(pathSet);
addEach(userinfoSet, [0x2F, 0x3A, 0x3B, 0x3D, 0x40, 0x5B, 0x5C, 0x5D, 0x7C]);

var componentSet = copySet(userinfoSet);
addEach(componentSet, [0x24, 0x25, 0x26, 0x2B, 0x2C]);

var formUrlencodedSet = copySet(componentSet);
addEach(formUrlencodedSet, [0x21, 0x27, 0x28, 0x29, 0x7E]);

// "percent-encode after encoding" with UTF-8.
function utf8PercentEncodeString(input, set, spaceAsPlus) {
  var out = "";
  var bytes = encoding.utf8Encode(input);
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (spaceAsPlus && b === 0x20) {
      out += "+";
      continue;
    }
    if (b < 0x80 && !set[b]) {
      out += String.fromCharCode(b);
    } else {
      out += percentEncodeByte(b);
    }
  }
  return out;
}

function percentDecodeBytes(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b !== 0x25) {
      out.push(b);
      continue;
    }
    var b1 = bytes[i + 1];
    var b2 = bytes[i + 2];
    if (b1 === undefined || b2 === undefined || !isASCIIHexDigit(b1) || !isASCIIHexDigit(b2)) {
      out.push(b);
      continue;
    }
    out.push(hexValue(b1) * 16 + hexValue(b2));
    i += 2;
  }
  return out;
}

function percentDecodeString(input) {
  return encoding.utf8Decode(percentDecodeBytes(encoding.utf8Encode(input)));
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------
var EMPTY_HOST = { type: "empty", value: "" };

function containsForbiddenDomainCodePoint(str) {
  var cps = codePoints(str);
  for (var i = 0; i < cps.length; i++) {
    var cp = cps[i];
    if (cp <= 0x20 || cp === 0x7F || cp === 0x25) return true;
    switch (cp) {
      case 0x23: case 0x2F: case 0x3A: case 0x3C: case 0x3E: case 0x3F:
      case 0x40: case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x7C:
        return true;
    }
  }
  return false;
}

function containsForbiddenHostCodePoint(str) {
  var cps = codePoints(str);
  for (var i = 0; i < cps.length; i++) {
    var cp = cps[i];
    switch (cp) {
      case 0x00: case 0x09: case 0x0A: case 0x0D: case 0x20: case 0x23:
      case 0x2F: case 0x3A: case 0x3C: case 0x3E: case 0x3F: case 0x40:
      case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x7C:
        return true;
    }
  }
  return false;
}

function domainToASCII(domain, beStrict) {
  return icu.toASCII(domain, beStrict);
}

function domainParser(domain, beStrict) {
  var strictResult = domainToASCII(domain, true);
  if (beStrict) {
    if (strictResult === null) return null;
    return strictResult;
  }
  var result;
  if (isASCIIStr(domain)) {
    result = asciiLowercase(domain);
  } else {
    result = domainToASCII(domain, false);
    if (result === null) return null;
  }
  if (result === "") return null;
  if (containsForbiddenDomainCodePoint(result)) return null;
  return result;
}

function isWindowsDriveLetter(str) {
  var cp = codePoints(str);
  return cp.length === 2 && isASCIIAlpha(cp[0]) && (cp[1] === 0x3A || cp[1] === 0x7C);
}
function isNormalizedWindowsDriveLetter(str) {
  var cp = codePoints(str);
  return cp.length === 2 && isASCIIAlpha(cp[0]) && cp[1] === 0x3A;
}
function startsWithWindowsDriveLetter(str) {
  var cp = codePoints(str);
  if (cp.length < 2) return false;
  if (!isASCIIAlpha(cp[0])) return false;
  if (cp[1] !== 0x3A && cp[1] !== 0x7C) return false;
  if (cp.length === 2) return true;
  return cp[2] === 0x2F || cp[2] === 0x5C || cp[2] === 0x3F || cp[2] === 0x23;
}

// Returns [value, validationError] or null (failure).
function ipv4NumberParser(input) {
  if (input === "") return null;
  var validationError = false;
  var start = 0;
  var radix = 10;
  if (input.length >= 2 && (input.substring(0, 2) === "0X" || input.substring(0, 2) === "0x")) {
    validationError = true;
    start = 2;
    radix = 16;
  } else if (input.length >= 2 && input.charCodeAt(0) === 0x30) {
    validationError = true;
    start = 1;
    radix = 8;
  }
  var body = input.substring(start);
  if (body === "") return [0, true];
  for (var i = 0; i < body.length; i++) {
    var c = body.charCodeAt(i);
    var valid = false;
    if (c >= 0x30 && c <= 0x39 && c - 0x30 < radix) {
      valid = true;
    } else if (radix === 16 && ((c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66))) {
      valid = true;
    }
    if (!valid) return null;
  }
  return [parseInt(body, radix), validationError];
}

function isAllASCIIDigits(str) {
  if (str === "") return false;
  for (var i = 0; i < str.length; i++) {
    if (!isASCIIDigit(str.charCodeAt(i))) return false;
  }
  return true;
}

// Returns an IPv4 address (32-bit int) or null (failure).
function ipv4Parser(input) {
  var parts = input.split(".");
  if (parts[parts.length - 1] === "") {
    if (parts.length > 1) parts.pop();
  }
  if (parts.length > 4) return null;
  var numbers = [];
  for (var i = 0; i < parts.length; i++) {
    var result = ipv4NumberParser(parts[i]);
    if (result === null) return null;
    numbers.push(result[0]);
  }
  for (var a = 0; a < numbers.length - 1; a++) {
    if (numbers[a] > 255) return null;
  }
  if (numbers[numbers.length - 1] >= Math.pow(256, 5 - numbers.length)) return null;
  var ipv4 = numbers[numbers.length - 1];
  numbers.pop();
  var counter = 0;
  for (var b = 0; b < numbers.length; b++) {
    ipv4 += numbers[b] * Math.pow(256, 3 - counter);
    counter++;
  }
  return ipv4;
}

function endsInNumberChecker(input) {
  var parts = input.split(".");
  if (parts[parts.length - 1] === "") parts.pop();
  var last = parts[parts.length - 1];
  if (last !== "" && isAllASCIIDigits(last)) return true;
  if (ipv4NumberParser(last) !== null) return true;
  return false;
}

// Returns 8 pieces or null (failure).
function ipv6Parser(input) {
  var address = [0, 0, 0, 0, 0, 0, 0, 0];
  var cps = codePoints(input);
  var len = cps.length;
  var pieceIndex = 0;
  var compress = null;
  var pointer = 0;

  function cpAt(p) {
    return p >= 0 && p < len ? cps[p] : EOF;
  }
  function remStartsColon() {
    return pointer + 1 < len && cps[pointer + 1] === 0x3A;
  }

  if (cpAt(0) === 0x3A) {
    if (!remStartsColon()) return null;
    pointer += 2;
    pieceIndex += 1;
    compress = pieceIndex;
  }

  while (cpAt(pointer) !== EOF) {
    if (pieceIndex === 8) return null;
    var c = cpAt(pointer);
    if (c === 0x3A) {
      if (compress !== null) return null;
      pointer += 1;
      pieceIndex += 1;
      compress = pieceIndex;
      continue;
    }
    var value = 0;
    var length = 0;
    while (length < 4 && isASCIIHexDigit(cpAt(pointer))) {
      value = value * 0x10 + hexValue(cpAt(pointer));
      pointer += 1;
      length += 1;
    }
    if (cpAt(pointer) === 0x2E) {
      if (length === 0) return null;
      pointer -= length;
      if (pieceIndex > 6) return null;
      var numbersSeen = 0;
      while (cpAt(pointer) !== EOF) {
        var ipv4Piece = null;
        if (numbersSeen > 0) {
          if (cpAt(pointer) === 0x2E && numbersSeen < 4) {
            pointer += 1;
          } else {
            return null;
          }
        }
        if (!isASCIIDigit(cpAt(pointer))) return null;
        while (isASCIIDigit(cpAt(pointer))) {
          var number = cpAt(pointer) - 0x30;
          if (ipv4Piece === null) {
            ipv4Piece = number;
          } else if (ipv4Piece === 0) {
            return null;
          } else {
            ipv4Piece = ipv4Piece * 10 + number;
          }
          if (ipv4Piece > 255) return null;
          pointer += 1;
        }
        address[pieceIndex] = address[pieceIndex] * 0x100 + ipv4Piece;
        numbersSeen += 1;
        if (numbersSeen === 2 || numbersSeen === 4) pieceIndex += 1;
      }
      if (numbersSeen !== 4) return null;
      break;
    } else if (cpAt(pointer) === 0x3A) {
      pointer += 1;
      if (cpAt(pointer) === EOF) return null;
    } else if (cpAt(pointer) !== EOF) {
      return null;
    }
    address[pieceIndex] = value;
    pieceIndex += 1;
  }

  if (compress !== null) {
    var swaps = pieceIndex - compress;
    pieceIndex = 7;
    while (pieceIndex !== 0 && swaps > 0) {
      var tmp = address[pieceIndex];
      address[pieceIndex] = address[compress + swaps - 1];
      address[compress + swaps - 1] = tmp;
      pieceIndex -= 1;
      swaps -= 1;
    }
  } else if (compress === null && pieceIndex !== 8) {
    return null;
  }
  return address;
}

function findIpv6CompressedPieceIndex(pieces) {
  var longestIndex = null;
  var longestSize = 1;
  var foundIndex = null;
  var foundSize = 0;
  for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
    if (pieces[pieceIndex] !== 0) {
      if (foundSize > longestSize) {
        longestIndex = foundIndex;
        longestSize = foundSize;
      }
      foundIndex = null;
      foundSize = 0;
    } else {
      if (foundIndex === null) foundIndex = pieceIndex;
      foundSize++;
    }
  }
  if (foundSize > longestSize) return foundIndex;
  return longestIndex;
}

function ipv4Serializer(address) {
  var output = "";
  var n = address;
  for (var i = 1; i <= 4; i++) {
    output = (n % 256) + output;
    if (i !== 4) output = "." + output;
    n = Math.floor(n / 256);
  }
  return output;
}

function ipv6Serializer(pieces) {
  var output = "";
  var compress = findIpv6CompressedPieceIndex(pieces);
  var ignore0 = false;
  for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
    if (ignore0 && pieces[pieceIndex] === 0) continue;
    if (ignore0) ignore0 = false;
    if (compress === pieceIndex) {
      var separator = pieceIndex === 0 ? "::" : ":";
      output += separator;
      ignore0 = true;
      continue;
    }
    output += pieces[pieceIndex].toString(16);
    if (pieceIndex !== 7) output += ":";
  }
  return output;
}

function opaqueHostParser(input) {
  // Only a forbidden host code point is a failure; the other two checks are
  // validation errors only (the input is still returned, C0-percent-encoded).
  if (containsForbiddenHostCodePoint(input)) return null;
  return utf8PercentEncodeString(input, c0ControlSet);
}

function hostParser(input, isOpaque) {
  if (input.charAt(0) === "[") {
    if (input.charAt(input.length - 1) !== "]") return null;
    var pieces = ipv6Parser(input.substring(1, input.length - 1));
    if (pieces === null) return null;
    return { type: "ipv6", pieces: pieces };
  }
  if (isOpaque) {
    var opaque = opaqueHostParser(input);
    if (opaque === null) return null;
    return { type: "opaque", value: opaque };
  }
  // Assert: input is not the empty string.
  var domain = percentDecodeString(input);
  var asciiDomain = domainParser(domain, false);
  if (asciiDomain === null) return null;
  if (endsInNumberChecker(asciiDomain)) {
    var ipv4 = ipv4Parser(asciiDomain);
    if (ipv4 === null) return null;
    return { type: "ipv4", value: ipv4 };
  }
  return { type: "domain", value: asciiDomain };
}

function serializeHost(host) {
  if (host === null || host === undefined) return "";
  if (host.type === "ipv4") return ipv4Serializer(host.value);
  if (host.type === "ipv6") return "[" + ipv6Serializer(host.pieces) + "]";
  return host.value;
}

// ---------------------------------------------------------------------------
// URL record
// ---------------------------------------------------------------------------
var SPECIAL_PORTS = { ftp: 21, file: null, http: 80, https: 443, ws: 80, wss: 443 };

function isSpecialScheme(scheme) {
  return Object.prototype.hasOwnProperty.call(SPECIAL_PORTS, scheme);
}
function defaultPort(scheme) {
  return isSpecialScheme(scheme) ? SPECIAL_PORTS[scheme] : null;
}

function newURLRecord() {
  return {
    scheme: "",
    username: "",
    password: "",
    host: null,
    port: null,
    path: [],
    query: null,
    fragment: null,
  };
}

function urlIsSpecial(url) {
  return isSpecialScheme(url.scheme);
}
function urlIncludesCredentials(url) {
  return url.username !== "" || url.password !== "";
}
function urlHasOpaquePath(url) {
  return typeof url.path === "string";
}
function urlHostIsEmpty(host) {
  if (host === null) return true;
  if (host.type === "empty") return true;
  return host.type === "opaque" && host.value === "";
}
function urlCannotHaveUsernamePasswordPort(url) {
  return url.host === null || urlHostIsEmpty(url.host) || url.scheme === "file";
}

function shortenPath(url) {
  var path = url.path;
  if (url.scheme === "file" && path.length === 1 && isNormalizedWindowsDriveLetter(path[0])) {
    return;
  }
  path.pop();
}

function serializeURLPath(url) {
  var path = url.path;
  if (typeof path === "string") return path;
  var output = "";
  for (var i = 0; i < path.length; i++) output += "/" + path[i];
  return output;
}

function serializeURL(url, excludeFragment) {
  var output = url.scheme + ":";
  if (url.host !== null) {
    output += "//";
    if (urlIncludesCredentials(url)) {
      output += url.username;
      if (url.password !== "") output += ":" + url.password;
      output += "@";
    }
    output += serializeHost(url.host);
    if (url.port !== null) output += ":" + url.port;
  }
  if (
    url.host === null &&
    !urlHasOpaquePath(url) &&
    url.path.length > 1 &&
    url.path[0] === ""
  ) {
    output += "/.";
  }
  output += serializeURLPath(url);
  if (url.query !== null) output += "?" + url.query;
  if (!excludeFragment && url.fragment !== null) output += "#" + url.fragment;
  return output;
}

function urlOrigin(url) {
  var s = url.scheme;
  if (s === "ftp" || s === "http" || s === "https" || s === "ws" || s === "wss") {
    return { scheme: s, host: url.host, port: url.port };
  }
  if (s === "blob") {
    var pathURL = basicURLParser(serializeURLPath(url), null, null, null);
    if (
      pathURL !== null &&
      (pathURL.scheme === "http" || pathURL.scheme === "https" || pathURL.scheme === "file")
    ) {
      return urlOrigin(pathURL);
    }
    return null;
  }
  return null; // opaque origin
}

function serializeOrigin(origin) {
  if (origin === null) return "null";
  var s = origin.scheme + "://" + serializeHost(origin.host);
  if (origin.port !== null) s += ":" + origin.port;
  return s;
}

// ---------------------------------------------------------------------------
// Basic URL parser
// ---------------------------------------------------------------------------
const SCHEME_START = "scheme_start";
const SCHEME = "scheme";
const NO_SCHEME = "no_scheme";
const SPECIAL_RELATIVE_OR_AUTHORITY = "special_relative_or_authority";
const PATH_OR_AUTHORITY = "path_or_authority";
const RELATIVE = "relative";
const RELATIVE_SLASH = "relative_slash";
const SPECIAL_AUTHORITY_SLASHES = "special_authority_slashes";
const SPECIAL_AUTHORITY_IGNORE_SLASHES = "special_authority_ignore_slashes";
const AUTHORITY = "authority";
const HOST = "host";
const HOSTNAME = "hostname";
const PORT = "port";
const FILE = "file";
const FILE_SLASH = "file_slash";
const FILE_HOST = "file_host";
const PATH_START = "path_start";
const PATH = "path";
const CANNOT_BE_BASE = "cannot_be_base";
const QUERY = "query";
const FRAGMENT = "fragment";

// Returns a URL record, or null on failure. When `url` and `stateOverride` are
// given, `url` is modified in place (used by the API setters).
function basicURLParser(input, base, url, stateOverride) {
  if (url === undefined || url === null) url = newURLRecord();

  var cps = codePoints(input);
  if (!stateOverride) {
    var s = 0;
    while (s < cps.length && isC0ControlOrSpace(cps[s])) s++;
    var e = cps.length;
    while (e > s && isC0ControlOrSpace(cps[e - 1])) e--;
    cps = cps.slice(s, e);
  }
  var filtered = [];
  for (var fi = 0; fi < cps.length; fi++) {
    if (!isASCIITabOrNewline(cps[fi])) filtered.push(cps[fi]);
  }
  cps = filtered;

  var len = cps.length;
  var state = stateOverride || SCHEME_START;
  var buffer = "";
  var atSignSeen = false;
  var insideBrackets = false;
  var passwordTokenSeen = false;
  var pointer = 0;
  var host;

  function cpAt(p) {
    return p >= 0 && p < len ? cps[p] : EOF;
  }
  function remStarts(str) {
    var p = pointer + 1;
    for (var k = 0; k < str.length; k++) {
      if (p + k >= len) return false;
      if (cps[p + k] !== str.charCodeAt(k)) return false;
    }
    return true;
  }
  function remStartsOr(str) {
    if (pointer + 1 >= len) return false;
    return str.indexOf(fromCodePoint(cps[pointer + 1])) !== -1;
  }

  for (;;) {
    var c = cpAt(pointer);
    var eof = pointer >= len;

    switch (state) {
      case SCHEME_START:
        if (isASCIIAlpha(c)) {
          buffer += asciiLowercase(fromCodePoint(c));
          state = SCHEME;
        } else if (!stateOverride) {
          state = NO_SCHEME;
          pointer -= 1;
        } else {
          return null;
        }
        break;

      case SCHEME:
        if (
          isASCIIAlphanumeric(c) || c === 0x2B || c === 0x2D || c === 0x2E
        ) {
          buffer += asciiLowercase(fromCodePoint(c));
        } else if (c === 0x3A) {
          if (stateOverride) {
            if (isSpecialScheme(url.scheme) && !isSpecialScheme(buffer)) return url;
            if (!isSpecialScheme(url.scheme) && isSpecialScheme(buffer)) return url;
            if ((urlIncludesCredentials(url) || url.port !== null) && buffer === "file")
              return url;
            if (url.scheme === "file" && urlHostIsEmpty(url.host)) return url;
          }
          url.scheme = buffer;
          if (stateOverride) {
            if (url.port === defaultPort(url.scheme)) url.port = null;
            return url;
          }
          buffer = "";
          if (url.scheme === "file") {
            state = FILE;
          } else if (urlIsSpecial(url) && base && base.scheme === url.scheme) {
            state = SPECIAL_RELATIVE_OR_AUTHORITY;
          } else if (urlIsSpecial(url)) {
            state = SPECIAL_AUTHORITY_SLASHES;
          } else if (remStarts("/")) {
            state = PATH_OR_AUTHORITY;
            pointer += 1;
          } else {
            url.path = "";
            state = CANNOT_BE_BASE;
          }
        } else if (!stateOverride) {
          buffer = "";
          state = NO_SCHEME;
          pointer = -1;
        } else {
          return null;
        }
        break;

      case NO_SCHEME:
        if (!base || (urlHasOpaquePath(base) && c !== 0x23)) {
          return null;
        } else if (urlHasOpaquePath(base) && c === 0x23) {
          url.scheme = base.scheme;
          url.path = base.path;
          url.query = base.query;
          url.fragment = "";
          state = FRAGMENT;
        } else if (base.scheme !== "file") {
          state = RELATIVE;
          pointer -= 1;
        } else {
          state = FILE;
          pointer -= 1;
        }
        break;

      case SPECIAL_RELATIVE_OR_AUTHORITY:
        if (c === 0x2F && remStarts("/")) {
          state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
          pointer += 1;
        } else {
          state = RELATIVE;
          pointer -= 1;
        }
        break;

      case PATH_OR_AUTHORITY:
        if (c === 0x2F) {
          state = AUTHORITY;
        } else {
          state = PATH;
          pointer -= 1;
        }
        break;

      case RELATIVE:
        url.scheme = base.scheme;
        if (c === 0x2F) {
          state = RELATIVE_SLASH;
        } else if (urlIsSpecial(url) && c === 0x5C) {
          state = RELATIVE_SLASH;
        } else {
          url.username = base.username;
          url.password = base.password;
          url.host = base.host;
          url.port = base.port;
          url.path = base.path.slice();
          url.query = base.query;
          if (c === 0x3F) {
            url.query = "";
            state = QUERY;
          } else if (c === 0x23) {
            url.fragment = "";
            state = FRAGMENT;
          } else if (!eof) {
            url.query = null;
            shortenPath(url);
            state = PATH;
            pointer -= 1;
          }
        }
        break;

      case RELATIVE_SLASH:
        if (urlIsSpecial(url) && (c === 0x2F || c === 0x5C)) {
          state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
        } else if (c === 0x2F) {
          state = AUTHORITY;
        } else {
          url.username = base.username;
          url.password = base.password;
          url.host = base.host;
          url.port = base.port;
          state = PATH;
          pointer -= 1;
        }
        break;

      case SPECIAL_AUTHORITY_SLASHES:
        if (c === 0x2F && remStarts("/")) {
          state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
          pointer += 1;
        } else {
          state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
          pointer -= 1;
        }
        break;

      case SPECIAL_AUTHORITY_IGNORE_SLASHES:
        if (c !== 0x2F && c !== 0x5C) {
          state = AUTHORITY;
          pointer -= 1;
        }
        break;

      case AUTHORITY:
        if (c === 0x40) {
          if (atSignSeen) buffer = "%40" + buffer;
          atSignSeen = true;
          var bufCps = codePoints(buffer);
          for (var ai = 0; ai < bufCps.length; ai++) {
            var codePoint = bufCps[ai];
            if (codePoint === 0x3A && !passwordTokenSeen) {
              passwordTokenSeen = true;
              continue;
            }
            var enc = utf8PercentEncodeString(fromCodePoint(codePoint), userinfoSet);
            if (passwordTokenSeen) url.password += enc;
            else url.username += enc;
          }
          buffer = "";
        } else if (
          eof || c === 0x2F || c === 0x3F || c === 0x23 ||
          (urlIsSpecial(url) && c === 0x5C)
        ) {
          if (atSignSeen && buffer === "") return null;
          pointer -= codePoints(buffer).length + 1;
          buffer = "";
          state = HOST;
        } else {
          buffer += fromCodePoint(c);
        }
        break;

      case HOST:
      case HOSTNAME:
        if (stateOverride && url.scheme === "file") {
          pointer -= 1;
          state = FILE_HOST;
        } else if (c === 0x3A && !insideBrackets) {
          if (buffer === "") return null;
          if (stateOverride && stateOverride === HOSTNAME) return null;
          host = hostParser(buffer, !urlIsSpecial(url));
          if (host === null) return null;
          url.host = host;
          buffer = "";
          state = PORT;
        } else if (
          eof || c === 0x2F || c === 0x3F || c === 0x23 ||
          (urlIsSpecial(url) && c === 0x5C)
        ) {
          pointer -= 1;
          if (urlIsSpecial(url) && buffer === "") return null;
          if (
            stateOverride && buffer === "" &&
            (urlIncludesCredentials(url) || url.port !== null)
          ) {
            return null;
          }
          host = hostParser(buffer, !urlIsSpecial(url));
          if (host === null) return null;
          url.host = host;
          buffer = "";
          state = PATH_START;
          if (stateOverride) return url;
        } else {
          if (c === 0x5B) insideBrackets = true;
          if (c === 0x5D) insideBrackets = false;
          buffer += fromCodePoint(c);
        }
        break;

      case PORT:
        if (isASCIIDigit(c)) {
          buffer += fromCodePoint(c);
        } else if (
          eof || c === 0x2F || c === 0x3F || c === 0x23 ||
          (urlIsSpecial(url) && c === 0x5C) || stateOverride
        ) {
          if (buffer !== "") {
            var port = parseInt(buffer, 10);
            if (port > 0xFFFF) return null;
            url.port = port === defaultPort(url.scheme) ? null : port;
            buffer = "";
            if (stateOverride) return url;
          }
          if (stateOverride) return null;
          state = PATH_START;
          pointer -= 1;
        } else {
          return null;
        }
        break;

      case FILE:
        url.scheme = "file";
        url.host = EMPTY_HOST;
        if (c === 0x2F || c === 0x5C) {
          state = FILE_SLASH;
        } else if (base && base.scheme === "file") {
          url.host = base.host;
          url.path = base.path.slice();
          url.query = base.query;
          if (c === 0x3F) {
            url.query = "";
            state = QUERY;
          } else if (c === 0x23) {
            url.fragment = "";
            state = FRAGMENT;
          } else if (!eof) {
            url.query = null;
            var subFile = "";
            for (var kfi = pointer; kfi < len; kfi++) subFile += fromCodePoint(cps[kfi]);
            if (!startsWithWindowsDriveLetter(subFile)) {
              shortenPath(url);
            } else {
              url.path = [];
            }
            state = PATH;
            pointer -= 1;
          }
        } else {
          state = PATH;
          pointer -= 1;
        }
        break;

      case FILE_SLASH:
        if (c === 0x2F || c === 0x5C) {
          state = FILE_HOST;
        } else {
          if (base && base.scheme === "file") {
            url.host = base.host;
            var subSlash = "";
            for (var ksi = pointer; ksi < len; ksi++) subSlash += fromCodePoint(cps[ksi]);
            if (
              !startsWithWindowsDriveLetter(subSlash) &&
              base.path.length > 0 &&
              isNormalizedWindowsDriveLetter(base.path[0])
            ) {
              url.path.push(base.path[0]);
            }
          }
          state = PATH;
          pointer -= 1;
        }
        break;

      case FILE_HOST:
        if (eof || c === 0x2F || c === 0x5C || c === 0x3F || c === 0x23) {
          pointer -= 1;
          if (!stateOverride && isWindowsDriveLetter(buffer)) {
            state = PATH;
          } else if (buffer === "") {
            url.host = EMPTY_HOST;
            if (stateOverride) return url;
            state = PATH_START;
          } else {
            host = hostParser(buffer, !urlIsSpecial(url));
            if (host === null) return null;
            if (host.type === "domain" && host.value === "localhost") host = EMPTY_HOST;
            url.host = host;
            if (stateOverride) return url;
            buffer = "";
            state = PATH_START;
          }
        } else {
          buffer += fromCodePoint(c);
        }
        break;

      case PATH_START:
        if (urlIsSpecial(url)) {
          state = PATH;
          if (c !== 0x2F && c !== 0x5C) pointer -= 1;
        } else if (!stateOverride && c === 0x3F) {
          url.query = "";
          state = QUERY;
        } else if (!stateOverride && c === 0x23) {
          url.fragment = "";
          state = FRAGMENT;
        } else if (!eof) {
          state = PATH;
          if (c !== 0x2F) pointer -= 1;
        } else if (stateOverride && url.host === null) {
          url.path.push("");
        }
        break;

      case PATH:
        if (
          eof || c === 0x2F || (urlIsSpecial(url) && c === 0x5C) ||
          (!stateOverride && (c === 0x3F || c === 0x23))
        ) {
          if (buffer === ".." || isDoubleDotSegment(buffer)) {
            shortenPath(url);
            if (!(c === 0x2F || (urlIsSpecial(url) && c === 0x5C))) url.path.push("");
          } else if (
            (buffer === "." || buffer.toLowerCase() === "%2e") &&
            !(c === 0x2F || (urlIsSpecial(url) && c === 0x5C))
          ) {
            url.path.push("");
          } else if (!(buffer === "." || buffer.toLowerCase() === "%2e")) {
            if (url.scheme === "file" && url.path.length === 0 && isWindowsDriveLetter(buffer)) {
              buffer = buffer.substring(0, 1) + ":";
            }
            url.path.push(buffer);
          }
          buffer = "";
          if (c === 0x3F) {
            url.query = "";
            state = QUERY;
          }
          if (c === 0x23) {
            url.fragment = "";
            state = FRAGMENT;
          }
        } else {
          buffer += utf8PercentEncodeString(fromCodePoint(c), pathSet);
        }
        break;

      case CANNOT_BE_BASE:
        if (c === 0x3F) {
          url.query = "";
          state = QUERY;
        } else if (c === 0x23) {
          url.fragment = "";
          state = FRAGMENT;
        } else if (c === 0x20) {
          if (remStartsOr("?#")) url.path += "%20";
          else url.path += " ";
        } else if (!eof) {
          url.path += utf8PercentEncodeString(fromCodePoint(c), c0ControlSet);
        }
        break;

      case QUERY:
        if (eof || (!stateOverride && c === 0x23)) {
          var qset = urlIsSpecial(url) ? specialQuerySet : querySet;
          url.query += utf8PercentEncodeString(buffer, qset);
          buffer = "";
          if (c === 0x23) {
            url.fragment = "";
            state = FRAGMENT;
          }
        } else if (!eof) {
          buffer += fromCodePoint(c);
        }
        break;

      case FRAGMENT:
        if (!eof) {
          url.fragment += utf8PercentEncodeString(fromCodePoint(c), fragmentSet);
        }
        break;
    }

    if (pointer >= len) break;
    pointer++;
  }

  return url;
}

function isSingleDotSegment(buffer) {
  return buffer === "." || buffer.toLowerCase() === "%2e";
}
function isDoubleDotSegment(buffer) {
  var l = buffer.toLowerCase();
  return buffer === ".." || l === ".%2e" || l === "%2e." || l === "%2e%2e";
}

// ---------------------------------------------------------------------------
// application/x-www-form-urlencoded
// ---------------------------------------------------------------------------
function splitBytes(bytes, sep) {
  var out = [];
  var start = 0;
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] === sep) {
      out.push(bytes.slice(start, i));
      start = i + 1;
    }
  }
  out.push(bytes.slice(start));
  return out;
}
function indexOfByte(bytes, target) {
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] === target) return i;
  }
  return -1;
}
function replaceByte(bytes, from, to) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) out.push(bytes[i] === from ? to : bytes[i]);
  return out;
}

// "urlencoded string parser"
function urlencodedStringParser(input) {
  var bytes = encoding.utf8Encode(input);
  var sequences = splitBytes(bytes, 0x26);
  var output = [];
  for (var i = 0; i < sequences.length; i++) {
    var b = sequences[i];
    if (b.length === 0) continue;
    var name, value;
    var eq = indexOfByte(b, 0x3D);
    if (eq !== -1) {
      name = b.slice(0, eq);
      value = b.slice(eq + 1);
    } else {
      name = b;
      value = [];
    }
    name = replaceByte(name, 0x2B, 0x20);
    value = replaceByte(value, 0x2B, 0x20);
    output.push([encoding.utf8Decode(percentDecodeBytes(name)), encoding.utf8Decode(percentDecodeBytes(value))]);
  }
  return output;
}

// "urlencoded serializer"
function urlencodedSerializer(tuples) {
  var output = "";
  for (var i = 0; i < tuples.length; i++) {
    var name = utf8PercentEncodeString(tuples[i][0], formUrlencodedSet, true);
    var value = utf8PercentEncodeString(tuples[i][1], formUrlencodedSet, true);
    if (output !== "") output += "&";
    output += name + "=" + value;
  }
  return output;
}

// ---------------------------------------------------------------------------
// URLSearchParams
// ---------------------------------------------------------------------------
function isInterfacePrototype(value) {
  if (typeof value !== "object" || value === null) return false;
  var ctor = value.constructor;
  return typeof ctor === "function" && ctor.prototype === value;
}

function URLSearchParams(init) {
  this._list = [];
  this._urlObject = null;
  if (init === undefined || init === null) return;
  if (typeof init === "string") {
    var s = init.charAt(0) === "?" ? init.substring(1) : init;
    this._list = urlencodedStringParser(s);
    return;
  }
  if (Array.isArray(init)) {
    for (var a = 0; a < init.length; a++) {
      var inner = init[a];
      if (!Array.isArray(inner) || inner.length !== 2) {
        throw new TypeError("URLSearchParams: init item must be a [name, value] pair");
      }
      this._list.push([toUSVString(inner[0]), toUSVString(inner[1])]);
    }
    return;
  }
  if (typeof init === "object" || typeof init === "function") {
    if (typeof init[Symbol.iterator] === "function") {
      var iterator = init[Symbol.iterator]();
      for (;;) {
        var step = iterator.next();
        if (step.done) break;
        var pair = step.value;
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new TypeError("URLSearchParams: init item must be a [name, value] pair");
        }
        this._list.push([toUSVString(pair[0]), toUSVString(pair[1])]);
      }
      return;
    }
    if (isInterfacePrototype(init)) {
      throw new TypeError("URLSearchParams: cannot initialize from an interface prototype");
    }
    var keys = Object.keys(init);
    var list = [];
    var indices = {};
    for (var k = 0; k < keys.length; k++) {
      var name = toUSVString(keys[k]);
      var value = toUSVString(init[keys[k]]);
      if (Object.prototype.hasOwnProperty.call(indices, name)) {
        list[indices[name]][1] = value;
      } else {
        indices[name] = list.length;
        list.push([name, value]);
      }
    }
    this._list = list;
    return;
  }
  this._list = urlencodedStringParser(toUSVString(init));
}

URLSearchParams.prototype._update = function () {
  if (this._urlObject === null) return;
  var serializedQuery = urlencodedSerializer(this._list);
  if (serializedQuery === "") serializedQuery = null;
  this._urlObject._url.query = serializedQuery;
};

URLSearchParams.prototype.append = function (name, value) {
  this._list.push([toUSVString(name), toUSVString(value)]);
  this._update();
};

URLSearchParams.prototype.delete = function (name, value) {
  var hasValue = arguments.length > 1 && value !== undefined;
  name = toUSVString(name);
  var compareValue = hasValue ? toUSVString(value) : null;
  var newList = [];
  for (var i = 0; i < this._list.length; i++) {
    var t = this._list[i];
    if (t[0] === name && (!hasValue || t[1] === compareValue)) continue;
    newList.push(t);
  }
  this._list = newList;
  this._update();
};

URLSearchParams.prototype.get = function (name) {
  name = toUSVString(name);
  for (var i = 0; i < this._list.length; i++) {
    if (this._list[i][0] === name) return this._list[i][1];
  }
  return null;
};

URLSearchParams.prototype.getAll = function (name) {
  name = toUSVString(name);
  var out = [];
  for (var i = 0; i < this._list.length; i++) {
    if (this._list[i][0] === name) out.push(this._list[i][1]);
  }
  return out;
};

URLSearchParams.prototype.has = function (name, value) {
  var hasValue = arguments.length > 1 && value !== undefined;
  name = toUSVString(name);
  var compareValue = hasValue ? toUSVString(value) : null;
  for (var i = 0; i < this._list.length; i++) {
    var t = this._list[i];
    if (t[0] === name && (!hasValue || t[1] === compareValue)) return true;
  }
  return false;
};

URLSearchParams.prototype.set = function (name, value) {
  name = toUSVString(name);
  value = toUSVString(value);
  var found = false;
  var newList = [];
  for (var i = 0; i < this._list.length; i++) {
    var t = this._list[i];
    if (t[0] === name) {
      if (!found) {
        newList.push([name, value]);
        found = true;
      }
    } else {
      newList.push(t);
    }
  }
  if (!found) newList.push([name, value]);
  this._list = newList;
  this._update();
};

URLSearchParams.prototype.forEach = function (callback, thisArg) {
  var list = this._list;
  for (var i = 0; i < list.length; i++) {
    callback.call(thisArg, list[i][1], list[i][0], this);
  }
};

URLSearchParams.prototype.sort = function () {
  var decorated = [];
  for (var i = 0; i < this._list.length; i++) decorated.push([this._list[i], i]);
  decorated.sort(function (a, b) {
    if (a[0][0] < b[0][0]) return -1;
    if (a[0][0] > b[0][0]) return 1;
    return a[1] - b[1];
  });
  this._list = [];
  for (var j = 0; j < decorated.length; j++) this._list.push(decorated[j][0]);
  this._update();
};

Object.defineProperty(URLSearchParams.prototype, "size", {
  get: function () {
    return this._list.length;
  },
  enumerable: true,
  configurable: true,
});

URLSearchParams.prototype[Symbol.iterator] = function () {
  var self = this;
  var i = 0;
  return {
    next: function () {
      var list = self._list;
      if (i < list.length) {
        var value = [list[i][0], list[i][1]];
        i++;
        return { value: value, done: false };
      }
      return { value: undefined, done: true };
    },
  };
};

URLSearchParams.prototype.toString = function () {
  return urlencodedSerializer(this._list);
};

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------
function apiURLParser(url, base) {
  var parsedBase = null;
  if (base !== null && base !== undefined) {
    parsedBase = basicURLParser(base, null, null, null);
    if (parsedBase === null) return null;
  }
  return basicURLParser(url, parsedBase, null, null);
}

function initializeURL(self, parsedRecord) {
  self._url = parsedRecord;
  self._searchParams = new URLSearchParams();
  if (parsedRecord.query !== null) {
    self._searchParams._list = urlencodedStringParser(parsedRecord.query);
  }
  self._searchParams._urlObject = self;
}

function URL(url, base) {
  var urlStr = String(url);
  var baseStr = base === undefined || base === null ? null : String(base);
  var parsed = apiURLParser(urlStr, baseStr);
  if (parsed === null) throw new TypeError("Invalid URL");
  initializeURL(this, parsed);
}

URL.parse = function (url, base) {
  var urlStr = String(url);
  var baseStr = base === undefined || base === null ? null : String(base);
  var parsed = apiURLParser(urlStr, baseStr);
  if (parsed === null) return null;
  var u = Object.create(URL.prototype);
  initializeURL(u, parsed);
  return u;
};

URL.canParse = function (url, base) {
  var urlStr = String(url);
  var baseStr = base === undefined || base === null ? null : String(base);
  return apiURLParser(urlStr, baseStr) !== null;
};

URL.prototype.toString = function () {
  return serializeURL(this._url);
};
URL.prototype.toJSON = function () {
  return serializeURL(this._url);
};

Object.defineProperty(URL.prototype, "href", {
  get: function () {
    return serializeURL(this._url);
  },
  set: function (value) {
    var parsed = basicURLParser(String(value), null, null, null);
    if (parsed === null) throw new TypeError("Invalid URL");
    this._url = parsed;
    this._searchParams._list = [];
    if (this._url.query !== null) {
      this._searchParams._list = urlencodedStringParser(this._url.query);
    }
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "origin", {
  get: function () {
    return serializeOrigin(urlOrigin(this._url));
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "protocol", {
  get: function () {
    return this._url.scheme + ":";
  },
  set: function (value) {
    basicURLParser(String(value) + ":", null, this._url, SCHEME_START);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "username", {
  get: function () {
    return this._url.username;
  },
  set: function (value) {
    if (urlCannotHaveUsernamePasswordPort(this._url)) return;
    this._url.username = utf8PercentEncodeString(String(value), userinfoSet);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "password", {
  get: function () {
    return this._url.password;
  },
  set: function (value) {
    if (urlCannotHaveUsernamePasswordPort(this._url)) return;
    this._url.password = utf8PercentEncodeString(String(value), userinfoSet);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "host", {
  get: function () {
    var url = this._url;
    if (url.host === null) return "";
    if (url.port === null) return serializeHost(url.host);
    return serializeHost(url.host) + ":" + url.port;
  },
  set: function (value) {
    if (urlHasOpaquePath(this._url)) return;
    basicURLParser(String(value), null, this._url, HOST);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "hostname", {
  get: function () {
    if (this._url.host === null) return "";
    return serializeHost(this._url.host);
  },
  set: function (value) {
    if (urlHasOpaquePath(this._url)) return;
    basicURLParser(String(value), null, this._url, HOSTNAME);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "port", {
  get: function () {
    if (this._url.port === null) return "";
    return String(this._url.port);
  },
  set: function (value) {
    if (urlCannotHaveUsernamePasswordPort(this._url)) return;
    value = String(value);
    if (value === "") {
      this._url.port = null;
      return;
    }
    basicURLParser(value, null, this._url, PORT);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "pathname", {
  get: function () {
    return serializeURLPath(this._url);
  },
  set: function (value) {
    if (urlHasOpaquePath(this._url)) return;
    this._url.path = [];
    basicURLParser(String(value), null, this._url, PATH_START);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "search", {
  get: function () {
    if (this._url.query === null || this._url.query === "") return "";
    return "?" + this._url.query;
  },
  set: function (value) {
    var url = this._url;
    value = String(value);
    if (value === "") {
      url.query = null;
      this._searchParams._list = [];
      return;
    }
    var input = value.charAt(0) === "?" ? value.substring(1) : value;
    url.query = "";
    basicURLParser(input, null, url, QUERY);
    this._searchParams._list = urlencodedStringParser(url.query);
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "searchParams", {
  get: function () {
    return this._searchParams;
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "hash", {
  get: function () {
    if (this._url.fragment === null || this._url.fragment === "") return "";
    return "#" + this._url.fragment;
  },
  set: function (value) {
    value = String(value);
    if (value === "") {
      this._url.fragment = null;
      return;
    }
    var input = value.charAt(0) === "#" ? value.substring(1) : value;
    this._url.fragment = "";
    basicURLParser(input, null, this._url, FRAGMENT);
  },
  enumerable: true,
  configurable: true,
});

exports.URL = URL;
exports.URLSearchParams = URLSearchParams;
