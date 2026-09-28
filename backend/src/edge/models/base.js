/**
 * MongoDB Atlas Data API client + Model adapter
 * Provides Mongoose-like API for Cloudflare Workers
 */

const DATA_API_URL = process.env.MONGODB_DATA_API_URL || 'https://data.mongodb.com/api/app/data-v2.endpoint/data/v1';
const DATA_API_KEY = process.env.MONGODB_DATA_API_KEY;
const DATA_SOURCE = process.env.MONGODB_DATA_SOURCE || 'Cluster0';
const DATABASE = process.env.MONGODB_DATABASE || 'efootball';

async function apiRequest(action, body = {}) {
  const response = await fetch(`${DATA_API_URL}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': DATA_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Data API ${action}: ${response.status} ${err}`);
  }
  return await response.json();
}

function fixId(id) {
  if (!id) return null;
  const str = String(id);
  if (str.length === 24 && /^[0-9a-fA-F]+$/.test(str)) return { $oid: str };
  return str;
}

function normalizeId(id) {
  if (!id) return null;
  if (typeof id === 'string' && id.length === 24 && /^[0-9a-fA-F]+$/.test(id)) return id;
  if (id && typeof id === 'object' && id.$oid) return id.$oid;
  return String(id);
}

function deepNormalize(obj) {
  if (!obj) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_id' && value && typeof value === 'object') {
      result[key] = normalizeId(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (item && typeof item === 'object') return deepNormalize(item);
        return normalizeId(item);
      });
    } else if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
      if (value.$oid) result[key] = value.$oid;
      else if (value.$date) result[key] = new Date(value.$date);
      else result[key] = deepNormalize(value);
    } else if (value instanceof Date) {
      result[key] = value.toISOString();
    } else {
      result[key] = value;
    }
  }
  return result;
}

const COLLECTIONS = {
  users: 'users',
  listings: 'listings',
  transactions: 'transactions',
  reports: 'reports',
  messages: 'messages',
  notifications: 'notifications',
  paymentmethods: 'paymentmethods',
  accountCredentials: 'accountCredentials',
};

async function fetchByIds(collection, ids, selectFields = null) {
  const validIds = ids.filter(Boolean).map(normalizeId);
  if (!validIds.length) return [];
  const filter = { _id: { $in: validIds.map(id => ({ $oid: id })) } };
  const res = await apiRequest('action/find', {
    dataSource: DATA_SOURCE,
    database: DATABASE,
    collection,
    filter,
  });
  return (res.documents || []).map(d => deepNormalize(d));
}

class QueryBuilder {
  constructor(model, filter, opts = {}) {
    this.model = model;
    this._filter = filter || {};
    this._sort = opts.sort || null;
    this._skipVal = opts.skip || 0;
    this._limitVal = opts.limit || null;
    this._selectStr = opts.select || null;
    this._populatePaths = [];
    this._isOne = false;
    if (opts.populate) {
      const paths = opts.populate.split(' ').filter(Boolean);
      for (const p of paths) this._populatePaths.push({ path: p });
    }
  }

  sort(s) { this._sort = s; return this; }
  skip(n) { this._skipVal = n; return this; }
  limit(n) { this._limitVal = n; return this; }
  select(s) { this._selectStr = s; return this; }
  populate(path, select) {
    this._populatePaths.push({ path, select });
    return this;
  }

  async exec() {
    let results = await this.model._execute(this._filter);

    if (this._sort) {
      results.sort((a, b) => {
        for (const [f, d] of Object.entries(this._sort)) {
          const av = a[f], bv = b[f];
          if (av === bv) continue;
          if (av instanceof Date || bv instanceof Date) {
            return d === 1 ? new Date(av) - new Date(bv) : new Date(bv) - new Date(av);
          }
          const avNum = Number(av), bvNum = Number(bv);
          if (!isNaN(avNum) && !isNaN(bvNum)) return d === 1 ? avNum - bvNum : bvNum - avNum;
          return d === 1 ? String(av) < String(bv) ? -1 : 1 : String(av) > String(bv) ? -1 : 1;
        }
        return 0;
      });
    }

    if (this._skipVal) results = results.slice(this._skipVal);
    if (this._limitVal) results = results.slice(0, this._limitVal);

    if (this._selectStr) {
      const parts = this._selectStr.split(' ').filter(Boolean);
      const exclude = parts.filter(f => f.startsWith('-'));
      const include = parts.filter(f => !f.startsWith('-'));
      results = results.map(doc => {
        if (exclude.length) {
          for (const f of exclude) delete doc[f.slice(1)];
        }
        if (include.length) {
          const sel = {};
          for (const f of include) if (doc[f] !== undefined) sel[f] = doc[f];
          Object.keys(doc).forEach(k => {
            if (!include.includes(k) && k !== '_id' && !Object.keys(sel).includes(k)) delete doc[k];
          });
          Object.assign(doc, sel);
        }
        return doc;
      });
    }

    for (const { path: populateSpec, select } of this._populatePaths) {
      const paths = populateSpec.split(' ').filter(Boolean);
      for (const p of paths) {
        const config = this.model._populates?.[p];
        if (config) {
          const foreignColl = config.collection || p.replace(/Id$/, 's');
          const localField = config.localField || p;
          const selFields = config.select || select;
          results = await Promise.all(results.map(async (doc) => {
            const val = doc[localField];
            if (!val) { doc[p] = null; return doc; }
            const ids = Array.isArray(val) ? val : [val];
            const related = await fetchByIds(foreignColl, ids, selFields);
            const byId = new Map(related.map(r => [r._id, r]));
            if (Array.isArray(val)) {
              doc[p] = val.map(v => byId.get(normalizeId(v))).filter(Boolean);
            } else {
              doc[p] = byId.get(normalizeId(val)) || null;
            }
            return doc;
          }));
        }
      }
    }

    return results.map(r => this.model._wrap(r));
  }

  then(resolve, reject) {
    const result = this.exec();
    if (this._isOne) {
      return result.then((results) => (results[0] || null)).then(resolve, reject);
    }
    return result.then(resolve, reject);
  }

  catch(fn) { return this.then(v => v, fn); }
  finally(fn) { return this.then(v => { fn(); return v; }, r => { fn(); throw r; }); }
}

function createModel(collectionName, config = {}) {
  const model = Object.create(null);

  model.collectionName = collectionName;
  model.collection = collectionName;
  model.modelName = collectionName;
  model._populates = config.populates || {};
  model._methods = config.methods || {};
  model._statics = config.statics || {};
  model._preCreate = config.preCreate;
  model._preUpdate = config.preUpdate;
  model._preSave = config.preSave;

  model._buildFilter = (filter) => {
    const result = {};
    for (const [key, value] of Object.entries(filter || {})) {
      if (value && typeof value === 'object' && value.$oid) {
        result[key] = value;
      } else if (key === '_id' && typeof value === 'string' && value.match(/^[0-9a-fA-F]{24}$/)) {
        result[key] = { $oid: value };
      } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        if (value.$in) {
          result[key] = { $in: value.$in.map(v => fixId(v)) };
        } else if (value.$nin) {
          result[key] = { $nin: value.$nin.map(v => fixId(v)) };
        } else if (value.$regex || value.$or || value.$and || value.$exists !== undefined || value.$ne) {
          result[key] = value;
        } else {
          result[key] = value;
        }
      } else if (Array.isArray(value) && value.length && value.every(v => typeof v === 'string' && v.match(/^[0-9a-fA-F]{24}$/))) {
        result[key] = { $in: value.map(v => ({ $oid: v })) };
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  model._wrap = (data) => {
    if (!data) return null;
    const doc = deepNormalize(data);
    if (model._methods) Object.assign(doc, model._methods);
    doc.raw = { ...doc };
    doc.isModified = (key) => key ? key in doc : true;
    doc.toObject = (opts = {}) => {
      const result = { ...doc };
      delete result.raw;
      delete result.isModified;
      delete result.toObject;
      delete result.toJSON;
      delete result.save;
      delete result.select;
      delete result.populate;
      return result;
    };
    doc.toJSON = () => doc.toObject();

    const origSave = async function() {
      if (model._preSave) {
        await model._preSave.call(doc, doc);
      }
      if (doc._id) {
        const update = { $set: { ...doc } };
        delete update.$set._id;
        delete update.$set.raw;
        delete update.$set.isModified;
        delete update.$set.toObject;
        delete update.$set.toJSON;
        delete update.$set.save;
        delete update.$set.select;
        delete update.$set.populate;
        delete update.$set.averageRating;
        await apiRequest('action/updateOne', {
          dataSource: DATA_SOURCE,
          database: DATABASE,
          collection: collectionName,
          filter: { _id: fixId(doc._id) },
          update,
        });
      } else {
        const data = { ...doc };
        delete data._id;
        delete data.raw;
        delete data.isModified;
        delete data.toObject;
        delete data.toJSON;
        delete data.save;
        const res = await apiRequest('action/insertOne', {
          dataSource: DATA_SOURCE,
          database: DATABASE,
          collection: collectionName,
          document: data,
        });
        doc._id = res.insertedId;
      }
      doc.raw = { ...doc };
      return doc;
    };
    doc.save = origSave;

    doc.select = function(fields) {
      const parts = fields.split(' ').filter(Boolean);
      const exclude = parts.filter(f => f.startsWith('-'));
      const include = parts.filter(f => !f.startsWith('-'));
      const result = { ...doc };
      if (exclude.length) {
        for (const f of exclude) delete result[f.slice(1)];
      }
      if (include.length) {
        const sel = {};
        for (const f of include) if (doc[f] !== undefined) sel[f] = doc[f];
        Object.keys(result).forEach(k => {
          if (!include.includes(k) && k !== '_id' && !Object.keys(sel).includes(k)) delete result[k];
        });
        Object.assign(result, sel);
      }
      result.raw = { ...result };
      result.isModified = doc.isModified;
      result.toObject = doc.toObject;
      result.toJSON = doc.toJSON;
      result.save = doc.save;
      return result;
    };

    doc.populate = function() { return doc; };

    Object.defineProperty(doc, 'averageRating', {
      get: function() {
        const rc = doc.ratingCount;
        return rc > 0 ? (doc.rating / rc).toFixed(1) : 0;
      },
      configurable: true,
    });

    return doc;
  };

  model._execute = async (filter) => {
    const f = model._buildFilter(filter);
    const res = await apiRequest('action/find', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: f,
    });
    return res.documents || [];
  };

  model.find = (filter = {}, opts = {}) => {
    return new QueryBuilder(model, filter, opts);
  };

  model.findById = (id, opts = {}) => {
    const qb = new QueryBuilder(model, { _id: id }, opts);
    qb._isOne = true;
    return qb;
  };

  model.findOne = (filter = {}, opts = {}) => {
    const qb = new QueryBuilder(model, filter, opts);
    qb._isOne = true;
    return qb;
  };

  model.create = async (data) => {
    let doc = { ...data };
    if (model._preCreate) doc = await model._preCreate(doc);
    doc.createdAt = doc.createdAt || new Date().toISOString();
    doc.updatedAt = doc.updatedAt || new Date().toISOString();
    delete doc._id;
    const res = await apiRequest('action/insertOne', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      document: doc,
    });
    const withId = { ...doc, _id: res.insertedId };
    return model._wrap(withId);
  };

  model.findByIdAndUpdate = async (id, update, opts = {}) => {
    if (model._preUpdate) await model._preUpdate({ _id: fixId(id) }, update);
    const updateDoc = { $set: { updatedAt: new Date().toISOString(), ...(update.$set || {}) } };
    for (const op of Object.keys(update)) {
      if (op !== '$set') updateDoc[op] = update[op];
    }
    await apiRequest('action/updateOne', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: { _id: fixId(id) },
      update: updateDoc,
    });
    if (opts.new !== false) return await model.findById(id, { populate: opts.populate, select: opts.select });
    return null;
  };

  model.findOneAndUpdate = async (filter, update, opts = {}) => {
    if (model._preUpdate) await model._preUpdate(filter, update);
    const updateDoc = { $set: { updatedAt: new Date().toISOString(), ...(update.$set || {}) } };
    for (const op of Object.keys(update)) {
      if (op !== '$set') updateDoc[op] = update[op];
    }
    await apiRequest('action/updateOne', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: model._buildFilter(filter),
      update: updateDoc,
    });
    if (opts.new !== false) return await model.findOne(filter, { populate: opts.populate });
    return null;
  };

  model.findByIdAndDelete = async (id) => {
    const qb = model.findById(id);
    const doc = await qb.exec();
    await apiRequest('action/deleteOne', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: { _id: fixId(id) },
    });
    return doc;
  };

  model.deleteOne = async (filter) => {
    const res = await apiRequest('action/deleteOne', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: model._buildFilter(filter),
    });
    return { deleted: res.deletedCount, n: 1, ok: 1 };
  };

  model.deleteMany = async (filter = {}) => {
    const res = await apiRequest('action/deleteMany', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: model._buildFilter(filter),
    });
    return { deleted: res.deletedCount, n: res.deletedCount, ok: 1 };
  };

  model.updateOne = async (filter, update) => {
    await apiRequest('action/updateOne', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: model._buildFilter(filter),
      update: JSON.parse(JSON.stringify(update)),
    });
    return { modified: 1, n: 1, ok: 1 };
  };

  model.updateMany = async (filter, update) => {
    await apiRequest('action/updateMany', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: model._buildFilter(filter),
      update: JSON.parse(JSON.stringify(update)),
    });
    return { modified: 1, n: 1, ok: 1 };
  };

  model.countDocuments = async (filter = {}) => {
    const res = await apiRequest('action/countDocuments', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      filter: model._buildFilter(filter),
    });
    return res.collectionCount || 0;
  };

  model.aggregate = async (pipeline) => {
    const res = await apiRequest('action/aggregate', {
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: collectionName,
      pipeline,
    });
    return (res.documents || []).map(d => model._wrap(d));
  };

  model.insertMany = async (docs) => {
    return Promise.all(docs.map(d => model.create(d)));
  };

  model.query = (filter = {}) => new QueryBuilder(model, filter);

  for (const [name, fn] of Object.entries(config.statics || {})) {
    model[name] = fn;
  }

  return model;
}

export { COLLECTIONS, apiRequest, fixId, normalizeId, deepNormalize, createModel, QueryBuilder, fetchByIds };
export default { COLLECTIONS, apiRequest, fixId, normalizeId, deepNormalize, createModel, QueryBuilder, fetchByIds };
