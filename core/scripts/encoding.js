// WHATWG Encoding API (partial) for Rhino.
// Runs untranspiled on Rhino: no `class`, no `async`/`await`, no argument
// spread. Prefer `const`/`let` over `var`.

const encodingBinding = getBinding("encoding");

function encodingIsAsciiWhitespace(cp) {
  return cp === 0x09 || cp === 0x0a || cp === 0x0c || cp === 0x0d || cp === 0x20;
}

function encodingStripAsciiWhitespace(str) {
  var start = 0;
  var end = str.length;
  while (start < end && encodingIsAsciiWhitespace(str.charCodeAt(start))) {
    start++;
  }
  while (end > start && encodingIsAsciiWhitespace(str.charCodeAt(end - 1))) {
    end--;
  }
  return str.substring(start, end);
}

function encodingAsciiLowercase(str) {
  var out = "";
  for (var i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0x41 && c <= 0x5a) {
      c += 0x20;
    }
    out += String.fromCharCode(c);
  }
  return out;
}

function TextEncoder() {
  if (!(this instanceof TextEncoder)) {
    throw new TypeError(
      "Failed to construct 'TextEncoder': Please use the 'new' operator."
    );
  }
  Object.defineProperty(this, "encoding", {
    value: "utf-8",
    enumerable: true,
    configurable: false,
  });
}

Object.defineProperty(TextEncoder.prototype, "encode", {
  value: function (input) {
    const data = typeof input === "undefined" ? "" : String(input);
    return encodingBinding.utf8Encode(data);
  },
  writable: true,
  enumerable: false,
  configurable: true,
});

function TextDecoder(label, options) {
  if (!(this instanceof TextDecoder)) {
    throw new TypeError(
      "Failed to construct 'TextDecoder': Please use the 'new' operator."
    );
  }
  var name = typeof label === "undefined" ? "utf-8" : String(label);
  name = encodingStripAsciiWhitespace(name);
  const entry = encodingLabels[encodingAsciiLowercase(name)];
  if (!entry || entry.replacement) {
    throw new RangeError(
      "The encoding label provided is not a supported encoding label."
    );
  }
  var fatal = false;
  var ignoreBom = false;
  if (typeof options === "object" && options !== null) {
    fatal = Boolean(options.fatal);
    ignoreBom = Boolean(options.ignoreBOM);
  }
  this._encoding = entry.name;
  this._fatal = fatal;
  this._ignoreBOM = ignoreBom;
  this._decoder = null;
  this._doNotFlush = false;
}

Object.defineProperty(TextDecoder.prototype, "encoding", {
  get: function () {
    return this._encoding;
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(TextDecoder.prototype, "fatal", {
  get: function () {
    return this._fatal;
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(TextDecoder.prototype, "ignoreBOM", {
  get: function () {
    return this._ignoreBOM;
  },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(TextDecoder.prototype, "decode", {
  value: function (input, options) {
    var stream = false;
    if (typeof options === "object" && options !== null) {
      stream = Boolean(options.stream);
    }
    if (!this._doNotFlush) {
      this._decoder = encodingBinding.newDecoder(
        this._encoding,
        this._fatal,
        this._ignoreBOM
      );
    }
    this._doNotFlush = stream;
    try {
      return this._decoder.decode(input, stream);
    } catch (e) {
      this._decoder = null;
      this._doNotFlush = false;
      throw e;
    }
  },
  writable: true,
  enumerable: false,
  configurable: true,
});

exports.TextEncoder = TextEncoder;
exports.TextDecoder = TextDecoder;
