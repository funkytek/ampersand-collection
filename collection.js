var _ = require('underscore');
var BackboneEvents = require('backbone-events-standalone');
var BackboneExtend = require('backbone-extend-standalone');
var isArray = require('is-array');
var extend = require('extend-object');


function Collection(models, options) {
    options || (options = {});
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, extend({silent: true}, options));
}

BackboneEvents.mixin(Collection.prototype);

Collection.prototype.initialize = function () {};

Collection.prototype.indexes = ['id'];

Collection.prototype.isModel = function (model) {
    return this.model && model instanceof this.model;
};

Collection.prototype.add = function (models, options) {
    return this.set(models, extend({merge: false, add: true, remove: false}, options));
};

// overridable parse method
Collection.prototype.parse = function (res, options) {
    return res;
};

Collection.prototype.set = function (models, options) {
    options = extend({add: true, remove: true, merge: true}, options);
    if (options.parse) models = this.parse(models, options);
    var singular = !isArray(models);
    models = singular ? (models ? [models] : []) : models.slice();
    var id, model, attrs, existing, sort;
    var at = options.at;
    var sortable = this.comparator && (at == null) && options.sort !== false;
    var sortAttr = ('string' === typeof this.comparator) ? this.comparator : null;
    var toAdd = [], toRemove = [], modelMap = {};
    var add = options.add, merge = options.merge, remove = options.remove;
    var order = !sortable && add && remove ? [] : false;
    var targetProto = this.model && this.model.prototype || Object.prototype;


    // Turn bare objects into model references, and prevent invalid models
    // from being added.
    for (var i = 0, length = models.length; i < length; i++) {
        attrs = models[i] || {};
        if (this.isModel(attrs)) {
            id = model = attrs;
        } else if (targetProto.generateId) {
            id = targetProto.generateId(attrs);
        } else {
            id = attrs[targetProto.idAttribute || 'id'];
        }

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        if (existing = this.get(id)) {
            if (remove) modelMap[existing.cid] = true;
            if (merge) {
                attrs = attrs === model ? model.attributes : attrs;
                if (options.parse) attrs = existing.parse(attrs, options);
                existing.set(attrs, options);
                if (sortable && !sort && existing.hasChanged(sortAttr)) sort = true;
            }
            models[i] = existing;

        // If this is a new, valid model, push it to the `toAdd` list.
        } else if (add) {
            model = models[i] = this._prepareModel(attrs, options);
            if (!model) continue;
            toAdd.push(model);
            this._addReference(model, options);
        }

        // Do not add multiple models with the same `id`.
        model = existing || model;
        if (!model) continue;
        if (order && (model.isNew() || !modelMap[model.id])) order.push(model);
        modelMap[model.id] = true;
    }

    // Remove nonexistent models if appropriate.
    if (remove) {
        for (var i = 0, length = this.length; i < length; i++) {
            if (!modelMap[(model = this.models[i]).cid]) toRemove.push(model);
        }
        if (toRemove.length) this.remove(toRemove, options);
    }

    // See if sorting is needed, update `length` and splice in new models.
    if (toAdd.length || (order && order.length)) {
        if (sortable) sort = true;
        this.length += toAdd.length;
        if (at != null) {
            for (var i = 0, length = toAdd.length; i < length; i++) {
                this.models.splice(at + i, 0, toAdd[i]);
            }
        } else {
            if (order) this.models.length = 0;
            var orderedModels = order || toAdd;
            for (var i = 0, length = orderedModels.length; i < length; i++) {
                this.models.push(orderedModels[i]);
            }
        }
    }

    // Silently sort the collection if appropriate.
    if (sort) this.sort({silent: true});

    // Unless silenced, it's time to fire all appropriate add/sort events.
    if (!options.silent) {
        for (var i = 0, length = toAdd.length; i < length; i++) {
            //(model = toAdd[i]).trigger('add', model, this, options);
        }
        if (sort || (order && order.length)) this.trigger('sort', this, options);
    }

    // Return the added (or merged) model (or models).
    return singular ? models[0] : models;
};

Collection.prototype.get = function (query, indexName) {
    if (!query) return;
    var index = this._indexes[indexName || 'id'];
    return index[query] || index[query.id];
};

// Get the model at the given index.
Collection.prototype.at = function(index) {
      return this.models[index];
};

Collection.prototype.remove = function (models) {
    var singular = !isArray(models);
    var i, length, model, index;

    models = singular ? [models] : _.clone(models);
    options || (options = {});
    for (i = 0, length = models.length; i < length; i++) {
        model = models[i] = this.get(models[i]);
        if (!model) continue;
        this._deIndex(model);
        index = this.indexOf(model);
        this.models.splice(index, 1);
        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }
        this._removeReference(model, options);
      }
      return singular ? models[0] : models;
};

Object.defineProperty(Collection.prototype, 'length', {
    get: function () {
        return this.models.length;
    }
})

// Private method to reset all internal state. Called when the collection
// is first initialized or reset.
Collection.prototype._reset = function() {
    var list = this.indexes || [];
    var i = 0;
    var l = list.length;
    this.models = [];
    this._indexes = {};
    for (; i < l; i++) {
        this._indexes[list[i]] = {};
    }
};

Collection.prototype._prepareModel = function(attrs, options) {
    // if we haven't defined a constructor, skip this
    if (!this.model) return attrs;

    if (this.isModel(attrs)) {
        return attrs;
    } else {
        options = options ? _.clone(options) : {};
        options.collection = this;
        return new this.model(attrs, options)
    }
};

Collection.prototype._deIndex = function (model) {
    for (name in this._indexes) {
        delete this._indexes[name][model[name] || model.get(name)];
    }
};

// Internal method to create a model's ties to a collection.
Collection.prototype._addReference = function(model, options) {
    for (var name in this._indexes) {
        var indexVal = model[name] || (model.get && model.get(name));
        if (indexVal) this._indexes[name][indexVal] = model;
    }
    //if (!model.collection) model.collection = this;
    //model.on('all', this._onModelEvent, this);
};

    // Internal method to sever a model's ties to a collection.
Collection.prototype._removeReference = function(model, options) {
    if (this === model.collection) delete model.collection;
    //model.off('all', this._onModelEvent, this);
};

// Underscore methods that we want to implement on the Collection.
var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
    'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
    'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
    'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
    'tail', 'drop', 'last', 'without', 'difference', 'indexOf', 'shuffle',
    'lastIndexOf', 'isEmpty', 'chain', 'sample', 'partition'
];

// Mix in each Underscore method as a proxy to `Collection#models`.
_.each(methods, function(method) {
    if (!_[method]) return;
    Collection.prototype[method] = function() {
        var args = slice.call(arguments);
        args.unshift(this.models);
        return _[method].apply(_, args);
    };
});

// Underscore methods that take a property name as an argument.
var attributeMethods = ['groupBy', 'countBy', 'sortBy', 'indexBy'];

// Use attributes instead of properties.
_.each(attributeMethods, function(method) {
    if (!_[method]) return;
    Collection.prototype[method] = function(value, context) {
        var iterator = _.isFunction(value) ? value : function(model) {
            return model.get(value);
        };
        return _[method](this.models, iterator, context);
    };
});


Collection.extend = BackboneExtend;


module.exports = Collection;