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
    DOMStringSizeError: 2,
    HierarchyRequestError: 3,
    WrongDocumentError: 4,
    InvalidCharacterError: 5,
    NoDataAllowedError: 6,
    NoModificationAllowedError: 7,
    NotFoundError: 8,
    NotSupportedError: 9,
    InUseAttributeError: 10,
    InvalidStateError: 11,
    SyntaxError: 12,
    InvalidModificationError: 13,
    NamespaceError: 14,
    InvalidAccessError: 15,
    ValidationError: 16,
    TypeMismatchError: 17,
    SecurityError: 18,
    NetworkError: 19,
    AbortError: 20,
    URLMismatchError: 21,
    QuotaExceededError: 22,
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

DOMException.prototype.constructor = DOMException;

var __domExceptionConstants = [
    ["INDEX_SIZE_ERR", 1],
    ["DOMSTRING_SIZE_ERR", 2],
    ["HIERARCHY_REQUEST_ERR", 3],
    ["WRONG_DOCUMENT_ERR", 4],
    ["INVALID_CHARACTER_ERR", 5],
    ["NO_DATA_ALLOWED_ERR", 6],
    ["NO_MODIFICATION_ALLOWED_ERR", 7],
    ["NOT_FOUND_ERR", 8],
    ["NOT_SUPPORTED_ERR", 9],
    ["INUSE_ATTRIBUTE_ERR", 10],
    ["INVALID_STATE_ERR", 11],
    ["SYNTAX_ERR", 12],
    ["INVALID_MODIFICATION_ERR", 13],
    ["NAMESPACE_ERR", 14],
    ["INVALID_ACCESS_ERR", 15],
    ["VALIDATION_ERR", 16],
    ["TYPE_MISMATCH_ERR", 17],
    ["SECURITY_ERR", 18],
    ["NETWORK_ERR", 19],
    ["ABORT_ERR", 20],
    ["URL_MISMATCH_ERR", 21],
    ["QUOTA_EXCEEDED_ERR", 22],
    ["TIMEOUT_ERR", 23],
    ["INVALID_NODE_TYPE_ERR", 24],
    ["DATA_CLONE_ERR", 25]
];

for (var __i = 0; __i < __domExceptionConstants.length; __i++) {
    Object.defineProperty(DOMException, __domExceptionConstants[__i][0], {
        value: __domExceptionConstants[__i][1],
        writable: true,
        enumerable: true,
        configurable: true
    });
}

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
