require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable.");
}

const client = new MongoClient(MONGODB_URI);

let db;
let collection;
let initialized = false;
let cache = null;
let writeQueue = Promise.resolve();

function createDefaultData() {
  return {
    treasury: 0,
    accounts: {},
    points: {},
    pendingDeposits: {},
    fees: {},
    withdrawals: {},
    events: {},
    pendingBoosts: {},
    setupMessages: {},
    cooldowns: {
      deposits: {},
    },
    applications: {},
    eventDepositTasks: {},
    boostHistory: {},
  };
}

function mergeDefaults(data) {
  const defaults = createDefaultData();
  return {
    ...defaults,
    ...(data || {}),
    cooldowns: {
      ...defaults.cooldowns,
      ...((data && data.cooldowns) || {}),
    },
  };
}

async function initDatabase() {
  if (initialized) return;

  await client.connect();
  db = client.db("consortium_bank");
  collection = db.collection("bot_data");

  const existing = await collection.findOne({ _id: "main" });

  if (!existing) {
    cache = createDefaultData();
    await collection.insertOne({
      _id: "main",
      ...cache,
    });
  } else {
    const { _id, ...rest } = existing;
    cache = mergeDefaults(rest);
  }

  initialized = true;
  console.log("✅ Connected to MongoDB");
}

function loadData() {
  if (!cache) {
    cache = createDefaultData();
  }
  return cache;
}

function saveData(data) {
  cache = mergeDefaults(data);

  if (!initialized || !collection) {
    return;
  }

  writeQueue = writeQueue
    .then(() =>
      collection.replaceOne(
        { _id: "main" },
        { _id: "main", ...cache },
        { upsert: true }
      )
    )
    .catch((error) => {
      console.error("MongoDB save failed:", error);
    });

  return writeQueue;
}

async function flushData() {
  await writeQueue;
}

process.on("SIGINT", async () => {
  try {
    await flushData();
    await client.close();
  } finally {
    process.exit(0);
  }
});

process.on("SIGTERM", async () => {
  try {
    await flushData();
    await client.close();
  } finally {
    process.exit(0);
  }
});

module.exports = {
  initDatabase,
  loadData,
  saveData,
};
