var GLOBAL = {
    isWindow: function () {
        return false;
    },
    isShadowRealm: function () {
        return false;
    }
};

var __domExceptionCodes = {
    IndexSizeError: 1,
    HierarchyRequestError: 3,
    WrongDocumentError: 4,
    InvalidCharacterError: 5,
    NoModificationAllowedError: 7,
    NotFoundError: 8,
    NotSupportedError: 9,
    InUseAttributeError: 10,
    InvalidStateError: 11,
    SyntaxError: 12,
    InvalidModificationError: 13,
    NamespaceError: 14,
    InvalidAccessError: 15,
    TypeMismatchError: 17,
    SecurityError: 18,
    NetworkError: 19,
    AbortError: 20,
    URLMismatchError: 21,
    TimeoutError: 23,
    InvalidNodeTypeError: 24,
    DataCloneError: 25
};

var DOMException = function (message, name) {
    var err = new Error(message);
    err.constructor = DOMException;
    err.name = name || "Error";
    err.code = __domExceptionCodes[err.name] || 0;
    return err;
};

var structuredClone = function (value) {
    throw new DOMException("The value could not be cloned.", "DataCloneError");
};

var FormData = function () {
    this._entries = [];
};

FormData.prototype.append = function (name, value) {
    this._entries.push([String(name), String(value)]);
};

FormData.prototype.has = function (name) {
    for (var i = 0; i < this._entries.length; i++) {
        if (this._entries[i][0] === String(name)) {
            return true;
        }
    }
    return false;
};

FormData.prototype[Symbol.iterator] = function () {
    var entries = this._entries;
    var i = 0;
    return {
        next: function () {
            if (i < entries.length) {
                return { value: entries[i++], done: false };
            }
            return { value: undefined, done: true };
        }
    };
};
