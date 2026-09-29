/**
 * storage.js – Versioned JSON import/export with an injectable adapter.
 * The adapter is an object with { get(key), set(key, value), remove(key) }.
 * Default adapter uses localStorage.
 */

const STORAGE_KEY = 'nutrilabel-tracker';
const STORAGE_VERSION = 1;

/**
 * Create a storage adapter with default localStorage fallback.
 * @param {Object} [adapter] – optional adapter with get/set/remove
 * @returns {Object} storage instance
 */
export function createStorage(adapter) {
  const store = adapter || {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage full or unavailable
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage full or unavailable
      }
    },
  };

  return {
    /**
     * Load all data from storage.
     * @returns {Object} { products: [], trackers: [], meals: [] }
     */
    load() {
      const raw = store.get(STORAGE_KEY);
      if (!raw) return { products: [], trackers: [], meals: [] };
      if (raw.version !== STORAGE_VERSION) {
        // Version mismatch – return empty
        return { products: [], trackers: [], meals: [] };
      }
      return {
        products: raw.products || [],
        trackers: raw.trackers || [],
        meals: raw.meals || [],
      };
    },

    /**
     * Save all data to storage.
     * @param {Object} data – { products: [], trackers: [], meals: [] }
     */
    save(data) {
      const payload = {
        version: STORAGE_VERSION,
        products: data.products || [],
        trackers: data.trackers || [],
        meals: data.meals || [],
      };
      store.set(STORAGE_KEY, payload);
    },

    /**
     * Export data as a JSON string.
     * @returns {string} JSON string
     */
    exportJSON() {
      const data = this.load();
      return JSON.stringify(data, null, 2);
    },

    /**
     * Import data from a JSON string.
     * @param {string} json – JSON string
     * @returns {Object} { products: [], trackers: [], meals: [] }
     */
    importJSON(json) {
      try {
        const data = JSON.parse(json);
        if (data.version !== STORAGE_VERSION) {
          throw new Error('Version mismatch');
        }
        this.save(data);
        return data;
      } catch (err) {
        throw new Error(`Invalid import data: ${err.message}`);
      }
    },

    /**
     * Clear all data.
     */
    clear() {
      store.remove(STORAGE_KEY);
    },
  };
}