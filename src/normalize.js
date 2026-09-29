/**
 * normalize.js – Deterministic normalization of raw OCR rows into canonical
 * nutrient values.  Pure functions, no I/O, no browser/Node APIs.
 */

// ── Multilingual synonym map ────────────────────────────────────────────────
const SYNONYMS = {
  energy_kj: [
    'Energie', 'energie', 'energi', 'energia', 'energy',
  ],
  energy_kcal: [
    'kcal',
  ],
  fat: [
    'Fett', 'vetten', 'matières grasses', 'grassi', 'fat', 'grasas',
  ],
  saturated_fat: [
    'davon gesättigte Fettsäuren',
    'davon gesättigte',
    'davon zucker',
    'davon zuckern',
    'davon suikers',
    'davon sucres',
    'davon zuccheri',
    'davon zuccher',
    'davon sugars',
    'davon azúcares',
    'davon azucar',
    'davon fibra',
    'davon fibre',
    'davon fibres',
    'davon vezels',
    'davon Ballaststoffe',
    'davon eiweiß',
    'davon eiwitten',
    'davon protéines',
    'davon proteine',
    'davon protein',
    'davon proteínas',
    'davon gesättigte Fettsäuren',
    'verzadigde vetzuren',
    'acides gras saturés',
    'di cui acidi grassi saturi',
    'of which saturates',
    'de los cuales saturadas',
  ],
  carbs: [
    'Kohlenhydrate', 'koolhydraten', 'glucides', 'carboidrati',
    'carbohydrates', 'hidratos de carbono',
  ],
  sugars: [
    'Zucker', 'suikers', 'sucres', 'zuccheri', 'sugars', 'azúcares',
  ],
  fiber: [
    'Ballaststoffe', 'vezels', 'fibres', 'fibre', 'fiber', 'fibra',
  ],
  protein: [
    'Eiweiß', 'Eiweiss', 'eiwitten', 'protéines', 'proteine',
    'protein', 'proteínas',
  ],
  salt: [
    'Salz', 'zout', 'sel', 'sale', 'salt', 'sal',
  ],
  sodium: [
    'Natrium', 'natrium', 'sodium', 'sodio',
  ],
};

// Build a lookup: lowercase synonym → canonical key
const SYNONYM_MAP = {};
for (const [key, synonyms] of Object.entries(SYNONYMS)) {
  for (const s of synonyms) {
    SYNONYM_MAP[s.toLowerCase()] = key;
  }
}

/**
 * Map a label string to a canonical nutrient key.
 * Returns null if no match.
 */
export function mapLabelToKey(label) {
  if (!label) return null;
  const lower = label.toLowerCase().trim();

  // Try exact match first
  if (SYNONYM_MAP[lower]) return SYNONYM_MAP[lower];

  // Try substring match for "davon Zucker" → sugars, etc.
  for (const [syn, key] of Object.entries(SYNONYM_MAP)) {
    if (lower.includes(syn) || syn.includes(lower)) {
      return key;
    }
  }

  // Try matching individual words
  const words = lower.split(/[\s,;:]+/);
  for (const word of words) {
    if (SYNONYM_MAP[word]) return SYNONYM_MAP[word];
  }

  return null;
}

/**
 * Parse a value string into a number.
 * Handles comma/period decimal separators.
 * Returns { value: number | null, flags: object }
 */
export function parseValue(valueStr) {
  if (valueStr == null) return { value: null, flags: {} };

  const str = String(valueStr).trim();

  // Below detection limit
  if (str.startsWith('<')) {
    return { value: null, flags: { belowDetectionLimit: true } };
  }

  // Remove any non-numeric characters except . , -
  let cleaned = str.replace(/[^0-9.,\-]/g, '');
  if (!cleaned) return { value: null, flags: {} };

  // Handle comma as decimal separator
  // If there's a comma and a period, assume comma is decimal and period is thousands
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.indexOf(',') > cleaned.indexOf('.')) {
      // 1.000,50 → 1000.50
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,000.50 → 1000.50 (comma is thousands)
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const num = Number(cleaned);
  if (isNaN(num)) return { value: null, flags: {} };

  return { value: num, flags: {} };
}

/**
 * Convert kJ to kcal.
 */
export function convertKjToKcal(kj) {
  return kj / 4.184;
}

/**
 * Convert kcal to kJ.
 */
export function convertKcalToKj(kcal) {
  return kcal * 4.184;
}

/**
 * Convert salt to sodium (sodium = salt / 2.5).
 */
export function saltToSodium(salt) {
  if (salt == null) return null;
  return salt / 2.5;
}

/**
 * Convert sodium to salt (salt = sodium * 2.5).
 */
export function sodiumToSalt(sodium) {
  if (sodium == null) return null;
  return sodium * 2.5;
}

/**
 * Scale nutrient values from baseAmount to targetAmount.
 */
export function scaleNutrients(nutrients, baseAmount, targetAmount) {
  if (!nutrients || baseAmount == null || targetAmount == null) return nutrients;
  const ratio = targetAmount / baseAmount;
  const scaled = {};
  for (const [key, value] of Object.entries(nutrients)) {
    if (key === 'vitamins' || key === 'minerals') {
      scaled[key] = value;
    } else if (value == null) {
      scaled[key] = null;
    } else {
      scaled[key] = Math.round(value * ratio * 100) / 100;
    }
  }
  return scaled;
}

/**
 * Main normalization function.
 * Takes raw rows and returns normalized nutrient values.
 *
 * @param {Array<{label:string, value:string, unit:string, column:string}>} rawRows
 * @param {Object} options
 * @param {string} options.column - 'per_100g' | 'per_100ml' | 'per_serving'
 * @param {number} [options.servingSize] - serving size in base unit (for scaling)
 * @param {string} [options.baseUnit] - 'g' | 'ml'
 * @returns {{ nutrients: object, flags: object }}
 */
export function normalizeRows(rawRows, options = {}) {
  const { column = 'per_100g', servingSize, baseUnit = 'g' } = options;

  const nutrients = {};
  const flags = {};

  // Collect values by canonical key
  const collected = {};

  for (const row of rawRows || []) {
    const key = mapLabelToKey(row.label);
    if (!key) continue;

    // Skip non-nutrient columns if we want per_100
    if (column === 'per_100g' || column === 'per_100ml') {
      if (row.column && row.column !== column && row.column !== 'per_100g' && row.column !== 'per_100ml') {
        continue;
      }
    }

    const parsed = parseValue(row.value);
    if (parsed.value == null && !parsed.flags.belowDetectionLimit) continue;

    if (!collected[key]) collected[key] = [];
    collected[key].push({ value: parsed.value, unit: row.unit, flags: parsed.flags });
  }

  // Process each canonical key
  const nutrientKeys = [
    'energy_kj', 'energy_kcal', 'fat', 'saturated_fat',
    'carbs', 'sugars', 'fiber', 'protein', 'salt', 'sodium',
  ];

  for (const key of nutrientKeys) {
    const entries = collected[key] || [];
    if (entries.length === 0) {
      nutrients[key] = null;
      continue;
    }

    // Get the first numeric value (prefer per_100 column)
    let primaryValue = null;
    let primaryUnit = '';
    let primaryFlags = {};

    for (const entry of entries) {
      if (entry.value != null) {
        primaryValue = entry.value;
        primaryUnit = entry.unit;
        primaryFlags = entry.flags;
        break;
      }
    }

    if (primaryValue == null) {
      nutrients[key] = null;
      continue;
    }

    // Handle unit conversions
    if (key === 'energy_kj' && primaryUnit === 'kcal') {
      primaryValue = convertKcalToKj(primaryValue);
    } else if (key === 'energy_kcal' && primaryUnit === 'kJ') {
      primaryValue = convertKjToKcal(primaryValue);
    }

    // Check for mg → g conversion
    if (['fat', 'saturated_fat', 'carbs', 'sugars', 'fiber', 'protein', 'salt', 'sodium'].includes(key)) {
      if (primaryUnit === 'mg') {
        primaryValue = primaryValue / 1000;
      }
    }

    // Check for µg → mg conversion (for vitamins/minerals)
    // (handled separately)

    nutrients[key] = Math.round(primaryValue * 100) / 100;
  }

  // Handle vitamins and minerals
  const vitamins = {};
  const minerals = {};

  for (const row of rawRows || []) {
    const label = (row.label || '').toLowerCase().trim();

    // Check for vitamin entries
    const vitaminMatch = label.match(/vitamin\s*([a-z0-9]+)/i);
    if (vitaminMatch) {
      const vitaminName = vitaminMatch[1].toLowerCase();
      const parsed = parseValue(row.value);
      if (parsed.value != null) {
        // If unit is %, skip; otherwise use the value
        if (row.unit !== '%') {
          let val = parsed.value;
          if (row.unit === 'µg' || row.unit === 'μg') {
            val = val / 1000; // µg → mg
          }
          vitamins[`vitamin_${vitaminName}_mg`] = Math.round(val * 100) / 100;
        }
      }
    }

    // Check for mineral entries
    const mineralMatch = label.match(/(calcium|iron|magnesium|phosphorus|potassium|zinc)/i);
    if (mineralMatch) {
      const mineralName = mineralMatch[1].toLowerCase();
      const parsed = parseValue(row.value);
      if (parsed.value != null) {
        if (row.unit !== '%') {
          let val = parsed.value;
          if (row.unit === 'µg' || row.unit === 'μg') {
            val = val / 1000;
          }
          minerals[`${mineralName}_mg`] = Math.round(val * 100) / 100;
        }
      }
    }
  }

  if (Object.keys(vitamins).length > 0) {
    nutrients.vitamins = vitamins;
  }
  if (Object.keys(minerals).length > 0) {
    nutrients.minerals = minerals;
  }

  // kJ / kcal consistency check
  if (nutrients.energy_kj != null && nutrients.energy_kcal != null) {
    const expectedKcal = convertKjToKcal(nutrients.energy_kj);
    const diff = Math.abs(expectedKcal - nutrients.energy_kcal) / nutrients.energy_kcal;
    if (diff > 0.05) {
      nutrients.energy_kj = null;
      nutrients.energy_kcal = null;
      flags.inconsistentUnits = true;
    }
  }

  // Salt / sodium consistency check
  if (nutrients.salt != null && nutrients.sodium != null) {
    const expectedSodium = saltToSodium(nutrients.salt);
    const diff = Math.abs(expectedSodium - nutrients.sodium) / nutrients.sodium;
    if (diff > 0.10) {
      nutrients.salt = null;
      nutrients.sodium = null;
      flags.inconsistentUnits = true;
    }
  }

  // If only salt, derive sodium
  if (nutrients.salt != null && nutrients.sodium == null) {
    nutrients.sodium = Math.round(saltToSodium(nutrients.salt) * 1000) / 1000;
  }

  // If only sodium, derive salt
  if (nutrients.sodium != null && nutrients.salt == null) {
    nutrients.salt = Math.round(sodiumToSalt(nutrients.sodium) * 1000) / 1000;
  }

  // If belowDetectionLimit flag was set, mark it
  for (const entry of rawRows || []) {
    const parsed = parseValue(entry.value);
    if (parsed.flags.belowDetectionLimit) {
      const key = mapLabelToKey(entry.label);
      if (key && key !== 'energy_kcal') {
        // Already handled by parseValue returning null
      }
    }
  }

  // Scale if per_serving column was selected
  if (column === 'per_serving' && servingSize && baseUnit) {
    // We need to scale from serving to 100
    // But the spec says: if per_serving is selected, scale to 100g/ml
    // Actually re-reading: "If the user selects 'per serving', values are scaled to 100 g/ml"
    // So we scale from serving to 100
    const scaled = scaleNutrients(nutrients, servingSize, 100);
    // Merge back (vitamins/minerals don't scale)
    for (const [key, value] of Object.entries(scaled)) {
      if (key !== 'vitamins' && key !== 'minerals') {
        nutrients[key] = value;
      }
    }
  }

  return { nutrients, flags };
}