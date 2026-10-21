// WHATWG URL standard implementation (URL + URLSearchParams).
// Runs untranspiled on Rhino: no `class`, no `async`/`await`, no argument
// spread. Prefer `const`/`let` over `var`.

// The "url" binding holds the URL standard's table/byte algorithms
// (percent-encoding, host parsing/serialization, urlencoded parse/serialize,
// toUSVString, code points). The basic URL parser state machine stays in JS,
// along with the small per-character helpers below. Those helpers stay in JS
// on purpose: the parse loop calls them for every input code point, and making
// each one a binding call would add a JS<->Java crossing per character.
// urlpattern.js (loaded in the same module scope) reuses fromCodePoint,
// isASCIIDigit, isASCIIHexDigit, asciiLowercase, and basicURLParser from here.
const urlparse = getBinding("url");

const EOF = -1;

function fromCodePoint(cp) {
  if (cp <= 0xFFFF) return String.fromCharCode(cp);
  cp -= 0x10000;
  return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
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
// Hosts
// ---------------------------------------------------------------------------
const EMPTY_HOST = { type: "empty", value: "" };

function isWindowsDriveLetter(str) {
  const cp = urlparse.codePoints(str);
  return cp.length === 2 && isASCIIAlpha(cp[0]) && (cp[1] === 0x3A || cp[1] === 0x7C);
}
function isNormalizedWindowsDriveLetter(str) {
  const cp = urlparse.codePoints(str);
  return cp.length === 2 && isASCIIAlpha(cp[0]) && cp[1] === 0x3A;
}
function startsWithWindowsDriveLetter(str) {
  const cp = urlparse.codePoints(str);
  if (cp.length < 2) return false;
  if (!isASCIIAlpha(cp[0])) return false;
  if (cp[1] !== 0x3A && cp[1] !== 0x7C) return false;
  if (cp.length === 2) return true;
  return cp[2] === 0x2F || cp[2] === 0x5C || cp[2] === 0x3F || cp[2] === 0x23;
}

// ---------------------------------------------------------------------------
// URL record
// ---------------------------------------------------------------------------
const SPECIAL_PORTS = { ftp: 21, file: null, http: 80, https: 443, ws: 80, wss: 443 };

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
  const path = url.path;
  if (url.scheme === "file" && path.length === 1 && isNormalizedWindowsDriveLetter(path[0])) {
    return;
  }
  path.pop();
}

function serializeURLPath(url) {
  const path = url.path;
  if (typeof path === "string") return path;
  let output = "";
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
    output += urlparse.serializeHost(url.host);
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
  const s = url.scheme;
  if (s === "ftp" || s === "http" || s === "https" || s === "ws" || s === "wss") {
    return { scheme: s, host: url.host, port: url.port };
  }
  if (s === "blob") {
    const pathURL = basicURLParser(serializeURLPath(url), null, null, null);
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
  let s = origin.scheme + "://" + urlparse.serializeHost(origin.host);
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

  let cps = urlparse.codePoints(input);
  if (!stateOverride) {
    var s = 0;
    while (s < cps.length && isC0ControlOrSpace(cps[s])) s++;
    var e = cps.length;
    while (e > s && isC0ControlOrSpace(cps[e - 1])) e--;
    cps = cps.slice(s, e);
  }
  const filtered = [];
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
  var fragmentBuffer = "";
  var opaqueBuffer = "";
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
    const eof = pointer >= len;

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
          // The first ":" in the whole userinfo (across "@" chunks) separates
          // username from password; everything after it goes to the password.
          if (passwordTokenSeen) {
            url.password += urlparse.percentEncode(buffer, "userinfo");
          } else {
            const colon = buffer.indexOf(":");
            if (colon === -1) {
              url.username += urlparse.percentEncode(buffer, "userinfo");
            } else {
              passwordTokenSeen = true;
              url.username += urlparse.percentEncode(buffer.substring(0, colon), "userinfo");
              url.password += urlparse.percentEncode(buffer.substring(colon + 1), "userinfo");
            }
          }
          buffer = "";
        } else if (
          eof || c === 0x2F || c === 0x3F || c === 0x23 ||
          (urlIsSpecial(url) && c === 0x5C)
        ) {
          if (atSignSeen && buffer === "") return null;
          pointer -= urlparse.codePoints(buffer).length + 1;
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
          host = urlparse.parseHost(buffer, !urlIsSpecial(url));
          if (host === undefined) return null;
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
          host = urlparse.parseHost(buffer, !urlIsSpecial(url));
          if (host === undefined) return null;
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
            const port = parseInt(buffer, 10);
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
            host = urlparse.parseHost(buffer, !urlIsSpecial(url));
            if (host === undefined) return null;
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
          // Dot-segment checks run on the raw buffer: none of '.', '%', '2',
          // 'e' are encoded by the path percent-encode set, so the raw and
          // encoded forms agree on these comparisons.
          if (buffer === ".." || isDoubleDotSegment(buffer)) {
            shortenPath(url);
            if (!(c === 0x2F || (urlIsSpecial(url) && c === 0x5C))) url.path.push("");
          } else if (
            isSingleDotSegment(buffer) &&
            !(c === 0x2F || (urlIsSpecial(url) && c === 0x5C))
          ) {
            url.path.push("");
          } else if (!isSingleDotSegment(buffer)) {
            if (url.scheme === "file" && url.path.length === 0 && isWindowsDriveLetter(buffer)) {
              buffer = buffer.substring(0, 1) + ":";
            }
            url.path.push(urlparse.percentEncode(buffer, "path"));
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
          buffer += fromCodePoint(c);
        }
        break;

      case CANNOT_BE_BASE:
        if (c === 0x3F) {
          url.path += urlparse.percentEncode(opaqueBuffer, "c0-control");
          opaqueBuffer = "";
          url.query = "";
          state = QUERY;
        } else if (c === 0x23) {
          url.path += urlparse.percentEncode(opaqueBuffer, "c0-control");
          opaqueBuffer = "";
          url.fragment = "";
          state = FRAGMENT;
        } else if (c === 0x20) {
          if (remStartsOr("?#")) opaqueBuffer += "%20";
          else opaqueBuffer += " ";
        } else if (!eof) {
          opaqueBuffer += fromCodePoint(c);
        } else {
          url.path += urlparse.percentEncode(opaqueBuffer, "c0-control");
        }
        break;

      case QUERY:
        if (eof || (!stateOverride && c === 0x23)) {
          url.query += urlparse.percentEncode(buffer, urlIsSpecial(url) ? "special-query" : "query");
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
          fragmentBuffer += fromCodePoint(c);
        } else {
          url.fragment += urlparse.percentEncode(fragmentBuffer, "fragment");
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
  const l = buffer.toLowerCase();
  return buffer === ".." || l === ".%2e" || l === "%2e." || l === "%2e%2e";
}

// ---------------------------------------------------------------------------
// URLSearchParams
// ---------------------------------------------------------------------------
function isInterfacePrototype(value) {
  if (typeof value !== "object" || value === null) return false;
  const ctor = value.constructor;
  return typeof ctor === "function" && ctor.prototype === value;
}

function URLSearchParams(init) {
  this._list = [];
  this._urlObject = null;
  if (init === undefined || init === null) return;
  if (typeof init === "string") {
    const s = init.charAt(0) === "?" ? init.substring(1) : init;
    this._list = urlparse.urlencodedParse(s);
    return;
  }
  if (Array.isArray(init)) {
    for (var a = 0; a < init.length; a++) {
      const inner = init[a];
      if (!Array.isArray(inner) || inner.length !== 2) {
        throw new TypeError("URLSearchParams: init item must be a [name, value] pair");
      }
      this._list.push([urlparse.toUSVString(inner[0]), urlparse.toUSVString(inner[1])]);
    }
    return;
  }
  if (typeof init === "object" || typeof init === "function") {
    if (typeof init[Symbol.iterator] === "function") {
      const iterator = init[Symbol.iterator]();
      for (;;) {
        const step = iterator.next();
        if (step.done) break;
        const pair = step.value;
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new TypeError("URLSearchParams: init item must be a [name, value] pair");
        }
        this._list.push([urlparse.toUSVString(pair[0]), urlparse.toUSVString(pair[1])]);
      }
      return;
    }
    if (isInterfacePrototype(init)) {
      throw new TypeError("URLSearchParams: cannot initialize from an interface prototype");
    }
    const keys = Object.keys(init);
    var list = [];
    var indices = {};
    for (var k = 0; k < keys.length; k++) {
      const name = urlparse.toUSVString(keys[k]);
      const value = urlparse.toUSVString(init[keys[k]]);
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
  this._list = urlparse.urlencodedParse(urlparse.toUSVString(init));
}

URLSearchParams.prototype._update = function () {
  if (this._urlObject === null) return;
  let serializedQuery = urlparse.urlencodedSerialize(this._list);
  if (serializedQuery === "") serializedQuery = null;
  this._urlObject._url.query = serializedQuery;
};

URLSearchParams.prototype.append = function (name, value) {
  this._list.push([urlparse.toUSVString(name), urlparse.toUSVString(value)]);
  this._update();
};

URLSearchParams.prototype.delete = function (name, value) {
  const hasValue = arguments.length > 1 && value !== undefined;
  name = urlparse.toUSVString(name);
  const compareValue = hasValue ? urlparse.toUSVString(value) : null;
  const newList = [];
  for (var i = 0; i < this._list.length; i++) {
    var t = this._list[i];
    if (t[0] === name && (!hasValue || t[1] === compareValue)) continue;
    newList.push(t);
  }
  this._list = newList;
  this._update();
};

URLSearchParams.prototype.get = function (name) {
  name = urlparse.toUSVString(name);
  for (var i = 0; i < this._list.length; i++) {
    if (this._list[i][0] === name) return this._list[i][1];
  }
  return null;
};

URLSearchParams.prototype.getAll = function (name) {
  name = urlparse.toUSVString(name);
  const out = [];
  for (var i = 0; i < this._list.length; i++) {
    if (this._list[i][0] === name) out.push(this._list[i][1]);
  }
  return out;
};

URLSearchParams.prototype.has = function (name, value) {
  const hasValue = arguments.length > 1 && value !== undefined;
  name = urlparse.toUSVString(name);
  const compareValue = hasValue ? urlparse.toUSVString(value) : null;
  for (var i = 0; i < this._list.length; i++) {
    const t = this._list[i];
    if (t[0] === name && (!hasValue || t[1] === compareValue)) return true;
  }
  return false;
};

URLSearchParams.prototype.set = function (name, value) {
  name = urlparse.toUSVString(name);
  value = urlparse.toUSVString(value);
  let found = false;
  const newList = [];
  for (var i = 0; i < this._list.length; i++) {
    const t = this._list[i];
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
  const list = this._list;
  for (var i = 0; i < list.length; i++) {
    callback.call(thisArg, list[i][1], list[i][0], this);
  }
};

URLSearchParams.prototype.sort = function () {
  const decorated = [];
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
  const self = this;
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
  return urlparse.urlencodedSerialize(this._list);
};

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------
function apiURLParser(url, base) {
  let parsedBase = null;
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
    self._searchParams._list = urlparse.urlencodedParse(parsedRecord.query);
  }
  self._searchParams._urlObject = self;
}

function URL(url, base) {
  const urlStr = String(url);
  const baseStr = base === undefined || base === null ? null : String(base);
  const parsed = apiURLParser(urlStr, baseStr);
  if (parsed === null) throw new TypeError("Invalid URL");
  initializeURL(this, parsed);
}

URL.parse = function (url, base) {
  const urlStr = String(url);
  const baseStr = base === undefined || base === null ? null : String(base);
  const parsed = apiURLParser(urlStr, baseStr);
  if (parsed === null) return null;
  const u = Object.create(URL.prototype);
  initializeURL(u, parsed);
  return u;
};

URL.canParse = function (url, base) {
  const urlStr = String(url);
  const baseStr = base === undefined || base === null ? null : String(base);
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
    const parsed = basicURLParser(String(value), null, null, null);
    if (parsed === null) throw new TypeError("Invalid URL");
    this._url = parsed;
    this._searchParams._list = [];
    if (this._url.query !== null) {
      this._searchParams._list = urlparse.urlencodedParse(this._url.query);
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
    this._url.username = urlparse.percentEncode(String(value), "userinfo");
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
    this._url.password = urlparse.percentEncode(String(value), "userinfo");
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(URL.prototype, "host", {
  get: function () {
    const url = this._url;
    if (url.host === null) return "";
    if (url.port === null) return urlparse.serializeHost(url.host);
    return urlparse.serializeHost(url.host) + ":" + url.port;
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
    return urlparse.serializeHost(this._url.host);
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
    const url = this._url;
    value = String(value);
    if (value === "") {
      url.query = null;
      this._searchParams._list = [];
      return;
    }
    const input = value.charAt(0) === "?" ? value.substring(1) : value;
    url.query = "";
    basicURLParser(input, null, url, QUERY);
    this._searchParams._list = urlparse.urlencodedParse(url.query);
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
    const input = value.charAt(0) === "#" ? value.substring(1) : value;
    this._url.fragment = "";
    basicURLParser(input, null, this._url, FRAGMENT);
  },
  enumerable: true,
  configurable: true,
});

exports.URL = URL;
exports.URLSearchParams = URLSearchParams;
