const fs = require("fs");
const path = require("path");

/**
 * Persistent Priority Queue
 *
 * Each item has:
 *   id       - unique identifier
 *   value    - arbitrary JSON-serializable value
 *   priority - numeric priority (smaller = higher priority for extract_min)
 *
 * The queue maintains two binary heaps:
 *   - minHeap: smallest priority first
 *   - maxHeap: largest priority first
 *
 * Both heaps contain item IDs. The actual item data is stored in `items`.
 * This gives efficient min/max extraction while allowing update/delete by ID.
 */
class PersistentPriorityQueue {
  constructor(filePath = path.join(__dirname, "queue-data.json")) {
    this.filePath = path.resolve(filePath);
    this.items = new Map();
    this.minHeap = [];
    this.maxHeap = [];
    this.minPos = new Map();
    this.maxPos = new Map();

    this._load();
  }

  /* ---------- Persistence ---------- */

  _load() {
    if (!fs.existsSync(this.filePath)) return;

    const raw = fs.readFileSync(this.filePath, "utf8").trim();
    if (!raw) return;

    const data = JSON.parse(raw);

    for (const item of data.items || []) {
      this.items.set(item.id, item);
      this.minHeap.push(item.id);
      this.maxHeap.push(item.id);
    }

    this._rebuildPositions();
    this._buildHeap(this.minHeap, this.minPos, (a, b) => this._compareMin(a, b));
    this._buildHeap(this.maxHeap, this.maxPos, (a, b) => this._compareMax(a, b));
  }

  _save() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const data = {
      version: 1,
      items: Array.from(this.items.values())
    };

    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  /* ---------- Public API ---------- */

  /**
   * insert(value, priority, id?)
   * Returns the generated/provided item ID.
   */
  insert(value, priority, id = null) {
    this._validatePriority(priority);

    const itemId = id ?? this._generateId();

    if (this.items.has(itemId)) {
      throw new Error(`Item with id "${itemId}" already exists`);
    }

    const item = {
      id: itemId,
      value,
      priority
    };

    this.items.set(itemId, item);
    this._heapPush(this.minHeap, this.minPos, itemId, (a, b) => this._compareMin(a, b));
    this._heapPush(this.maxHeap, this.maxPos, itemId, (a, b) => this._compareMax(a, b));
    this._save();

    return itemId;
  }

  /**
   * extract_min()
   * Removes and returns the item with the smallest priority.
   */
  extract_min() {
    return this._extract(this.minHeap, this.minPos, "min");
  }

  /**
   * extract_max()
   * Removes and returns the item with the largest priority.
   */
  extract_max() {
    return this._extract(this.maxHeap, this.maxPos, "max");
  }

  /**
   * peek()
   * Returns the item with the smallest priority without removing it.
   * Returns null when empty.
   */
  peek() {
    if (this.minHeap.length === 0) return null;
    return this._cloneItem(this.items.get(this.minHeap[0]));
  }

  /**
   * update(id, newPriority, newValue?)
   * Updates an existing item's priority and optionally its value.
   */
  update(id, newPriority, newValue) {
    this._validatePriority(newPriority);

    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Item with id "${id}" not found`);
    }

    item.priority = newPriority;
    if (arguments.length >= 3) {
      item.value = newValue;
    }

    this._fixPosition(
      this.minHeap,
      this.minPos,
      id,
      (a, b) => this._compareMin(a, b)
    );

    this._fixPosition(
      this.maxHeap,
      this.maxPos,
      id,
      (a, b) => this._compareMax(a, b)
    );

    this._save();
    return this._cloneItem(item);
  }

  /**
   * delete(id)
   * Deletes an item by ID and returns the deleted item.
   */
  delete(id) {
    if (!this.items.has(id)) {
      return null;
    }

    const item = this._cloneItem(this.items.get(id));

    this._heapRemove(
      this.minHeap,
      this.minPos,
      id,
      (a, b) => this._compareMin(a, b)
    );

    this._heapRemove(
      this.maxHeap,
      this.maxPos,
      id,
      (a, b) => this._compareMax(a, b)
    );

    this.items.delete(id);
    this._save();

    return item;
  }

  /**
   * is_empty()
   */
  is_empty() {
    return this.items.size === 0;
  }

  /* ---------- Extraction ---------- */

  _extract(heap, positionMap, type) {
    if (heap.length === 0) return null;

    const id = heap[0];
    const item = this._cloneItem(this.items.get(id));

    // Remove the item from both heaps.
    this._heapRemove(
      this.minHeap,
      this.minPos,
      id,
      (a, b) => this._compareMin(a, b)
    );

    this._heapRemove(
      this.maxHeap,
      this.maxPos,
      id,
      (a, b) => this._compareMax(a, b)
    );

    this.items.delete(id);
    this._save();

    return item;
  }

  /* ---------- Heap comparison ---------- */

  // Lower priority comes first in minHeap.
  _compareMin(idA, idB) {
    const a = this.items.get(idA);
    const b = this.items.get(idB);

    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // Deterministic tie-breaking.
    return String(a.id).localeCompare(String(b.id));
  }

  // Higher priority comes first in maxHeap.
  _compareMax(idA, idB) {
    const a = this.items.get(idA);
    const b = this.items.get(idB);

    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }

    return String(a.id).localeCompare(String(b.id));
  }

  /* ---------- Heap operations ---------- */

  _heapPush(heap, positionMap, id, compare) {
    heap.push(id);
    positionMap.set(id, heap.length - 1);
    this._bubbleUp(heap, positionMap, heap.length - 1, compare);
  }

  _heapRemove(heap, positionMap, id, compare) {
    const index = positionMap.get(id);
    if (index === undefined) return;

    const lastIndex = heap.length - 1;

    positionMap.delete(id);

    if (index === lastIndex) {
      heap.pop();
      return;
    }

    const lastId = heap.pop();
    heap[index] = lastId;
    positionMap.set(lastId, index);

    if (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[index], heap[parent]) < 0) {
        this._bubbleUp(heap, positionMap, index, compare);
        return;
      }
    }

    this._bubbleDown(heap, positionMap, index, compare);
  }

  _fixPosition(heap, positionMap, id, compare) {
    const index = positionMap.get(id);
    if (index === undefined) return;

    if (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[index], heap[parent]) < 0) {
        this._bubbleUp(heap, positionMap, index, compare);
        return;
      }
    }

    this._bubbleDown(heap, positionMap, index, compare);
  }

  _bubbleUp(heap, positionMap, index, compare) {
    let i = index;

    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);

      if (compare(heap[i], heap[parent]) >= 0) break;

      this._swap(heap, positionMap, i, parent);
      i = parent;
    }
  }

  _bubbleDown(heap, positionMap, index, compare) {
    let i = index;

    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let best = i;

      if (
        left < heap.length &&
        compare(heap[left], heap[best]) < 0
      ) {
        best = left;
      }

      if (
        right < heap.length &&
        compare(heap[right], heap[best]) < 0
      ) {
        best = right;
      }

      if (best === i) break;

      this._swap(heap, positionMap, i, best);
      i = best;
    }
  }

  _swap(heap, positionMap, i, j) {
    [heap[i], heap[j]] = [heap[j], heap[i]];
    positionMap.set(heap[i], i);
    positionMap.set(heap[j], j);
  }

  _buildHeap(heap, positionMap, compare) {
    positionMap.clear();
    for (let i = 0; i < heap.length; i++) {
      positionMap.set(heap[i], i);
    }

    for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
      this._bubbleDown(heap, positionMap, i, compare);
    }
  }

  _rebuildPositions() {
    for (let i = 0; i < this.minHeap.length; i++) {
      this.minPos.set(this.minHeap[i], i);
    }

    for (let i = 0; i < this.maxHeap.length; i++) {
      this.maxPos.set(this.maxHeap[i], i);
    }
  }

  /* ---------- Helpers ---------- */

  _generateId() {
    let id;
    do {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    } while (this.items.has(id));

    return id;
  }

  _validatePriority(priority) {
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new TypeError("priority must be a finite number");
    }
  }

  _cloneItem(item) {
    if (!item) return null;
    return JSON.parse(JSON.stringify(item));
  }
}

module.exports = PersistentPriorityQueue;
