/**
 * products.js – Product CRUD operations using an injectable storage adapter.
 */

import { v4 as uuidv4 } from './uuid.js';

/**
 * Create a products module backed by a storage adapter.
 * @param {Object} storage – { getProducts, saveProduct, updateProduct, deleteProduct }
 * @returns {Object}
 */
export function createProducts(storage) {
  return {
    /**
     * Get all products.
     * @returns {Array}
     */
    getAll() {
      return storage.getProducts() || [];
    },

    /**
     * Get a product by ID.
     * @param {string} id
     * @returns {Object|null}
     */
    getById(id) {
      const products = storage.getProducts() || [];
      return products.find(p => p.id === id) || null;
    },

    /**
     * Create a new product.
     * @param {Object} product – { name, baseUnit, baseAmount, servingSize, servingLabel, nutrients, source, photoUrl }
     * @returns {Object} The created product with id and timestamps.
     */
    create(product) {
      const now = new Date().toISOString();
      const newProduct = {
        id: uuidv4(),
        name: product.name || '',
        baseUnit: product.baseUnit || 'g',
        baseAmount: product.baseAmount || 100,
        servingSize: product.servingSize ?? null,
        servingLabel: product.servingLabel ?? null,
        nutrients: product.nutrients || {},
        source: product.source || 'manual',
        photoUrl: product.photoUrl || null,
        createdAt: now,
        updatedAt: now,
      };

      const products = storage.getProducts() || [];
      products.push(newProduct);
      storage.saveProduct(products);
      return newProduct;
    },

    /**
     * Update a product.
     * @param {string} id
     * @param {Object} updates
     * @returns {Object|null}
     */
    update(id, updates) {
      const products = storage.getProducts() || [];
      const index = products.findIndex(p => p.id === id);
      if (index === -1) return null;

      const updated = { ...products[index], ...updates, updatedAt: new Date().toISOString() };
      products[index] = updated;
      storage.saveProduct(products);
      return updated;
    },

    /**
     * Delete a product.
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
      const products = storage.getProducts() || [];
      const filtered = products.filter(p => p.id !== id);
      if (filtered.length === products.length) return false;
      storage.saveProduct(filtered);
      return true;
    },
  };
}