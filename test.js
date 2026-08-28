const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PersistentPriorityQueue = require("./module");

const dataFile = path.join(__dirname, "test-queue-data.json");

if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);

const q = new PersistentPriorityQueue(dataFile);

assert.strictEqual(q.is_empty(), true);

const low = q.insert("low", 10, "low");
const medium = q.insert("medium", 5, "medium");
const high = q.insert("high", 1, "high");

assert.strictEqual(low, "low");
assert.strictEqual(q.peek().id, "high");

assert.strictEqual(q.extract_min().id, "high");
assert.strictEqual(q.extract_max().id, "low");

q.update(medium, 20);
assert.strictEqual(q.peek().id, "medium");

const deleted = q.delete(medium);
assert.strictEqual(deleted.id, "medium");
assert.strictEqual(q.is_empty(), true);

// Persistence test.
q.insert("persisted", 7, "persisted");
const q2 = new PersistentPriorityQueue(dataFile);

assert.strictEqual(q2.is_empty(), false);
assert.strictEqual(q2.peek().id, "persisted");
assert.strictEqual(q2.extract_min().value, "persisted");
assert.strictEqual(q2.is_empty(), true);

fs.unlinkSync(dataFile);

console.log("All tests passed.");
