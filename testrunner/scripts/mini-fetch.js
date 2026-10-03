var exports = {};

var fetchBase = undefined;

exports.loadFetch = function loadFetch(load) {
    function FetchResult(data) {
        this.data = data;
    }

    FetchResult.prototype.json = function () {
        return Promise.resolve(JSON.parse(this.data));
    }

    return function (path) {
        return Promise.resolve(new FetchResult(load(path, fetchBase)));
    }
};

exports.setBase = function(base) {
    fetchBase = base;
}

exports;