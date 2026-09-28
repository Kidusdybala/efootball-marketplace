/**
 * MongoDB Atlas Data API client
 * HTTP-based MongoDB access for Cloudflare Workers
 * No native driver needed - uses fetch() to Atlas Data API
 */

const DATA_API_URL = process.env.MONGODB_DATA_API_URL || 'https://data.mongodb.com/api/app/data-v2.endpoint/data/v1';
const DATA_API_KEY = process.env.MONGODB_DATA_API_KEY || '';
const DATA_SOURCE = process.env.MONGODB_DATA_SOURCE || 'Cluster0';
const DATABASE = process.env.MONGODB_DATABASE || 'efootball';

const COLLECTIONS = {
  users: 'users',
  listings: 'listings',
  transactions: 'transactions',
  reports: 'reports',
  messages: 'messages',
  notifications: 'notifications',
  paymentmethods: 'paymentmethods',
  accountcredentials: 'accountCredentials',
};

async function dataApiRequest(action, body = {}) {
  const response = await fetch(`${DATA_API_URL}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': DATA_API_KEY,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      dataSource: DATA_SOURCE,
      database: DATABASE,
      collection: body.collection,
      ...body,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Data API ${action} failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Data API error: ${data.error}`);
  }
  return data;
}

function serializeId(id) {
  if (!id) return null;
  const str = String(id);
  if (str.match(/^[0-9a-fA-F]{24}$/)) return str;
  return str;
}

function deserializeDoc(doc) {
  if (!doc) return null;
  const result = { ...doc };
  if (result._id && typeof result._id === 'object') {
    result._id = result._id.$oid;
  }
  return result;
}

function serializeDoc(obj, excludeId = false) {
  const result = { ...obj };
  if (!excludeId && result._id) {
    result._id = typeof result._id === 'string' ? result._id : String(result._id);
  }
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Date) {
      result[key] = value.toISOString();
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (value.$oid) {
        result[key] = typeof value.$oid === 'string' ? value.$oid : String(value.$oid);
      }
    }
  }
  return result;
}

async function findOne(collection, filter, options = {}) {
  const data = await dataApiRequest('action/findOne', {
    collection,
    filter,
    ...options,
  });
  return deserializeDoc(data.document);
}

async function find(collection, filter = {}, options = {}) {
  const { sort, skip, limit, projection } = options;
  const data = await dataApiRequest('action/find', {
    collection,
    filter,
    ...(sort && { sort: { $numberLong: JSON.stringify(sort) } }),
    ...(skip !== undefined && { skip }),
    ...(limit !== undefined && { limit }),
    ...(projection && { projection }),
  });
  return (data.documents || []).map(deserializeDoc);
}

async function insertOne(collection, doc) {
  const data = await dataApiRequest('action/insertOne', {
    collection,
    document: serializeDoc(doc),
  });
  return data.insertedId;
}

async function insertMany(collection, docs) {
  const data = await dataApiRequest('action/insertMany', {
    collection,
    documents: docs.map(serializeDoc),
  });
  return data.insertedIds;
}

async function updateOne(collection, filter, update, options = {}) {
  const parsedUpdate = JSON.parse(JSON.stringify(update));
  for (const op of Object.keys(parsedUpdate)) {
    if (['$set', '$inc', '$push', '$pull', '$unset', '$min', '$max', '$mul', '$rename', '$addToSet'].includes(op)) {
      if (op === '$set') {
        parsedUpdate[op] = serializeDoc(parsedUpdate[op], true);
      }
    }
  }
  const data = await dataApiRequest('action/updateOne', {
    collection,
    filter,
    update: parsedUpdate,
    ...options,
  });
  return data.modifiedCount;
}

async function updateMany(collection, filter, update, options = {}) {
  const parsedUpdate = JSON.parse(JSON.stringify(update));
  const data = await dataApiRequest('action/updateMany', {
    collection,
    filter,
    update: parsedUpdate,
    ...options,
  });
  return data.modifiedCount;
}

async function replaceOne(collection, filter, replacement) {
  const parsedReplacement = JSON.parse(JSON.stringify(replacement));
  if (!parsedReplacement._id) delete parsedReplacement._id;
  const data = await dataApiRequest('action/replaceOne', {
    collection,
    filter,
    replacement: parsedReplacement,
  });
  return data.modifiedCount;
}

async function deleteOne(collection, filter) {
  const data = await dataApiRequest('action/deleteOne', {
    collection,
    filter,
  });
  return data.deletedCount;
}

async function deleteMany(collection, filter) {
  const data = await dataApiRequest('action/deleteMany', {
    collection,
    filter,
  });
  return data.deletedCount;
}

async function aggregate(collection, pipeline, options = {}) {
  const data = await dataApiRequest('action/aggregate', {
    collection,
    pipeline,
    ...options,
  });
  return (data.documents || []).map(deserializeDoc);
}

async function countDocuments(collection, filter = {}) {
  const data = await dataApiRequest('action/countDocuments', {
    collection,
    filter,
  });
  return data.collectionCount || 0;
}

async function findOneAndUpdate(collection, filter, update, options = {}) {
  const parsedUpdate = JSON.parse(JSON.stringify(update));
  for (const op of Object.keys(parsedUpdate)) {
    if (['$set'].includes(op)) {
      parsedUpdate[op] = serializeDoc(parsedUpdate[op], true);
    }
  }
  const data = await dataApiRequest('action/findOneAndUpdate', {
    collection,
    filter,
    update: parsedUpdate,
    ...options,
  });
  return deserializeDoc(data.document);
}

async function findOneAndReplace(collection, filter, replacement, options = {}) {
  const parsedReplacement = JSON.parse(JSON.stringify(replacement));
  if (!parsedReplacement._id) delete parsedReplacement._id;
  const data = await dataApiRequest('action/findOneAndReplace', {
    collection,
    filter,
    replacement: parsedReplacement,
    ...options,
  });
  return deserializeDoc(data.document);
}

async function findOneAndDelete(collection, filter, options = {}) {
  const data = await dataApiRequest('action/findOneAndDelete', {
    collection,
    filter,
    ...options,
  });
  return deserializeDoc(data.document);
}

const db = {
  collections: COLLECTIONS,
  findOne,
  find,
  insertOne,
  insertMany,
  updateOne,
  updateMany,
  replaceOne,
  deleteOne,
  deleteMany,
  aggregate,
  countDocuments,
  findOneAndUpdate,
  findOneAndReplace,
  findOneAndDelete,
  serializeId,
  serializeDoc,
  deserializeDoc,
};

export default db;
