# NutriLabel Tracker - Product Specification

## 1. Overview

A free, ad-free, client-side web app that lets users photograph nutrition labels from food products, extract the nutritional information using AI OCR, review and correct the extracted data, save products to a local library, and plan meals by specifying grams (or ml) of each product to calculate totals for any custom combination of nutrients (calories, sodium, saturated fat, etc.).

**Core value proposition:** Unlike existing apps that are paid or focused on a single goal (weight loss, heart health), this app lets users track any combination of nutrients they choose, for free, with no ads, no accounts, and all data stored locally on their device.

## 2. Stack

- **JavaScript ESM** (Node 24, no dependencies)
- **Server:** `node:http` (minimal HTTP server)
- **OCR/AI:** Injected adapter, configurable via environment variables (`OCR_PROVIDER`, `OCR_API_KEY`, `OCR_ENDPOINT`)
- **UI:** `public/` directory with HTML, CSS, and ES modules (no framework, no build step)
- **Tests:** `node:test`
- **CI:** GitHub Actions

## 3. Product Schema (Canonical)

Each product has the following fields:

```json
{
  "id": "string (UUID v4)",
  "name": "string",
  "baseUnit": "g | ml",
  "baseAmount": "number (100)",
  "servingSize": "number | null (optional, e.g., 30 for Schär Melto)",
  "servingLabel": "string | null (optional, e.g., '1 Melto')",
  "nutrients": {
    "energy_kcal": "number | null",
    "energy_kj": "number | null",
    "fat": "number | null",
    "saturated_fat": "number | null",
    "carbs": "number | null",
    "sugars": "number | null",
    "fiber": "number | null",
    "protein": "number | null",
    "salt": "number | null",
    "sodium": "number | null",
    "vitamins": { "vitamin_c_mg": "number | null", ... },
    "minerals": { "calcium_mg": "number | null", ... }
  },
  "source": "scanned | manual",
  "photoUrl": "string | null (reference only, not stored)",
  "createdAt": "ISO 8601 string",
  "updatedAt": "ISO 8601 string"
}
```

**Notes:**
- All nutrient values are per `baseUnit` (100 g or 100 ml).
- `salt` and `sodium` are both stored; sodium is derived from salt (sodium = salt / 2.5).
- Vitamins and minerals are optional and extensible.
- Values can be `null` if not available or uncertain.

## 4. OCR Extraction Contract

### 4.1 Injected Adapter

The OCR adapter is an injectable module with the following interface:

```javascript
/**
 * Extracts raw rows from a nutrition label image.
 * @param {Blob} image - The image file (JPEG/PNG).
 * @returns {Promise<RawRow[]>} Array of raw extracted rows.
 */
export async function extractNutrition(image) {
  // Implementation depends on the configured OCR provider.
  // Returns an array of raw row objects.
}
```

### 4.2 Raw Row Format

Each raw row returned by the OCR adapter:

```json
{
  "label": "string (original text from the image, e.g., 'Fett', 'vetten', 'matières grasses')",
  "value": "string (the numeric value, e.g., '33', '0,7', '<0,1')",
  "unit": "string (e.g., 'g', 'mg', 'kJ', 'kcal', '%')",
  "column": "string (e.g., 'per_100g', 'per_serving', 'per_100ml')"
}
```

### 4.3 Normalization (Deterministic)

The normalization module takes raw rows and produces canonical nutrient values. It is 100% deterministic with no AI involved.

#### 4.3.1 Multilingual Synonym Map

The following mappings are used to normalize labels to canonical nutrient keys:

| Canonical Key | Synonyms (DE, NL, FR, IT, EN, ES) |
|---|---|
| `energy_kj` | "Energie", "energie", "energi", "energia", "energy" |
| `energy_kcal` | "kcal" (detected from unit or label) |
| `fat` | "Fett", "vetten", "matières grasses", "grassi", "fat", "grasas" |
| `saturated_fat` | "davon gesättigte Fettsäuren", "verzadigde vetzuren", "acides gras saturés", "di cui acidi grassi saturi", "of which saturates", "de los cuales saturadas" |
| `carbs` | "Kohlenhydrate", "koolhydraten", "glucides", "carboidrati", "carbohydrates", "hidratos de carbono" |
| `sugars` | "Zucker", "suikers", "sucres", "zuccheri", "sugars", "azúcares" |
| `fiber` | "Ballaststoffe", "vezels", "fibres", "fibre", "fiber", "fibra" |
| `protein` | "Eiweiß", "eiwitten", "protéines", "proteine", "protein", "proteínas" |
| `salt` | "Salz", "zout", "sel", "sale", "salt", "sal" |
| `sodium` | "Natrium", "natrium", "sodium", "sodio" |

#### 4.3.2 Decimal Handling

- Comma (`,`) and period (`.`) are both accepted as decimal separators.
- Values like `"0,7"` → `0.7`, `"33"` → `33`, `"<0,1"` → `null` with flag `belowDetectionLimit: true`.

#### 4.3.3 Unit Conversions

- **kJ ↔ kcal:** 1 kcal = 4.184 kJ. If both are present, verify consistency (tolerance: ±5%). If inconsistent, both values are set to `null` with flag `inconsistentUnits: true`.
- **Salt ↔ Sodium:** sodium = salt / 2.5. If only salt is present, sodium is derived. If only sodium is present, salt is derived (salt = sodium * 2.5). If both are present, verify consistency (tolerance: ±10%).
- **mg ↔ g:** 1 g = 1000 mg.
- **µg ↔ mg:** 1 mg = 1000 µg.

#### 4.3.4 Column Selection

- The user chooses whether to use the "per 100 g/ml" column or the "per serving" column.
- If the user selects "per serving", values are scaled to 100 g/ml for canonical storage.
- If the user selects "per 100 g/ml", values are used as-is.

#### 4.3.5 Uncertain/Invalid Values

- If a value cannot be parsed, is inconsistent, or is below detection limit (`<0,1`), it is set to `null` with an appropriate flag.
- **Never invent or estimate values.**

### 4.4 Example: Schär Melto (Image 1)

**Raw OCR output (simplified):**

```json
[
  { "label": "Energie", "value": "2292", "unit": "kJ", "column": "per_100g" },
  { "label": "Energie", "value": "688", "unit": "kJ", "column": "per_serving" },
  { "label": "kcal", "value": "549", "unit": "kcal", "column": "per_100g" },
  { "label": "kcal", "value": "165", "unit": "kcal", "column": "per_serving" },
  { "label": "Fett", "value": "33", "unit": "g", "column": "per_100g" },
  { "label": "Fett", "value": "10", "unit": "g", "column": "per_serving" },
  { "label": "davon gesättigte Fettsäuren", "value": "13", "unit": "g", "column": "per_100g" },
  { "label": "davon gesättigte Fettsäuren", "value": "3,9", "unit": "g", "column": "per_serving" },
  { "label": "Kohlenhydrate", "value": "55", "unit": "g", "column": "per_100g" },
  { "label": "Kohlenhydrate", "value": "16", "unit": "g", "column": "per_serving" },
  { "label": "davon Zucker", "value": "45", "unit": "g", "column": "per_100g" },
  { "label": "davon Zucker", "value": "14", "unit": "g", "column": "per_serving" },
  { "label": "Ballaststoffe", "value": "2,4", "unit": "g", "column": "per_100g" },
  { "label": "Ballaststoffe", "value": "0,7", "unit": "g", "column": "per_serving" },
  { "label": "Eiweiß", "value": "6,8", "unit": "g", "column": "per_100g" },
  { "label": "Eiweiß", "value": "2,0", "unit": "g", "column": "per_serving" },
  { "label": "Salz", "value": "0,18", "unit": "g", "column": "per_100g" },
  { "label": "Salz", "value": "0,05", "unit": "g", "column": "per_serving" }
]
```

**Normalized output (per 100g):**

```json
{
  "energy_kj": 2292,
  "energy_kcal": 549,
  "fat": 33,
  "saturated_fat": 13,
  "carbs": 55,
  "sugars": 45,
  "fiber": 2.4,
  "protein": 6.8,
  "salt": 0.18,
  "sodium": 0.072
}
```

**Normalized output (per serving, 30g):**

```json
{
  "energy_kj": 688,
  "energy_kcal": 165,
  "fat": 10,
  "saturated_fat": 3.9,
  "carbs": 16,
  "sugars": 14,
  "fiber": 0.7,
  "protein": 2.0,
  "salt": 0.05,
  "sodium": 0.02
}
```

### 4.5 Example: AH Juice (Image 2)

**Raw OCR output (simplified, Dutch):**

```json
[
  { "label": "energie", "value": "199", "unit": "kJ", "column": "per_100ml" },
  { "label": "energie", "value": "399", "unit": "kJ", "column": "per_glas" },
  { "label": "kcal", "value": "47", "unit": "kcal", "column": "per_100ml" },
  { "label": "kcal", "value": "94", "unit": "kcal", "column": "per_glas" },
  { "label": "vetten", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "verzadigde vetzuren", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "koolhydraten", "value": "11", "unit": "g", "column": "per_100ml" },
  { "label": "suikers", "value": "10", "unit": "g", "column": "per_100ml" },
  { "label": "vezels", "value": "0,7", "unit": "g", "column": "per_100ml" },
  { "label": "eiwitten", "value": "0,4", "unit": "g", "column": "per_100ml" },
  { "label": "zout", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "vitamine C", "value": "26", "unit": "%", "column": "per_100ml" },
  { "label": "vitamine C", "value": "21", "unit": "mg", "column": "per_100ml" }
]
```

**Normalized output (per 100ml):**

```json
{
  "energy_kj": 199,
  "energy_kcal": 47,
  "fat": 0,
  "saturated_fat": 0,
  "carbs": 11,
  "sugars": 10,
  "fiber": 0.7,
  "protein": 0.4,
  "salt": 0,
  "sodium": 0,
  "vitamins": { "vitamin_c_mg": 21 }
}
```

### 4.6 Example: AH Oil Spray (Image 3)

**Raw OCR output (simplified, Dutch, per 100ml):**

```json
[
  { "label": "energie", "value": "3404", "unit": "kJ", "column": "per_100ml" },
  { "label": "kcal", "value": "828", "unit": "kcal", "column": "per_100ml" },
  { "label": "vetten", "value": "92", "unit": "g", "column": "per_100ml" },
  { "label": "verzadigde vetzuren", "value": "14", "unit": "g", "column": "per_100ml" },
  { "label": "koolhydraten", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "suikers", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "vezels", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "eiwitten", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "zout", "value": "0", "unit": "g", "column": "per_100ml" },
  { "label": "vitamine E", "value": "150", "unit": "%", "column": "per_100ml" },
  { "label": "vitamine E", "value": "18", "unit": "mg", "column": "per_100ml" }
]
```

**Normalized output (per 100ml):**

```json
{
  "energy_kj": 3404,
  "energy_kcal": 828,
  "fat": 92,
  "saturated_fat": 14,
  "carbs": 0,
  "sugars": 0,
  "fiber": 0,
  "protein": 0,
  "salt": 0,
  "sodium": 0,
  "vitamins": { "vitamin_e_mg": 18 }
}
```

## 5. Persistence

- **Storage:** `localStorage` with versioned schema.
- **Data stored:**
  - `products`: array of Product objects.
  - `trackers`: array of Tracker objects (see Section 7).
  - `meals`: array of Meal objects (see Section 8).
  - `settings`: user preferences (default column, etc.).
- **Export/Import:** JSON file export/import for backup and migration.
- **Photos:** Not stored; only a reference URL (if any) is kept.

## 6. Server

### 6.1 Minimal HTTP Server

- Built with Node's native `http` module.
- Serves static files from `public/`.
- Provides API endpoints:
  - `POST /api/extract`: Accepts an image, calls the OCR adapter, returns raw rows.
  - `GET /api/products`: Returns all products.
  - `POST /api/products`: Creates a new product.
  - `PUT /api/products/:id`: Updates a product.
  - `DELETE /api/products/:id`: Deletes a product.
  - `GET /api/trackers`: Returns all trackers.
  - `POST /api/trackers`: Creates a new tracker.
  - `PUT /api/trackers/:id`: Updates a tracker.
  - `DELETE /api/trackers/:id`: Deletes a tracker.
  - `GET /api/meals`: Returns all meals.
  - `POST /api/meals`: Creates a new meal.
  - `PUT /api/meals/:id`: Updates a meal.
  - `DELETE /api/meals/:id`: Deletes a meal.

### 6.2 OCR Endpoint

- `POST /api/extract` accepts a multipart form with an image.
- Calls the configured OCR adapter.
- Returns raw rows as JSON.
- **Rate limiting:** Per-IP rate limit (configurable, default: 10 requests per minute).
- **Size limit:** Max 10 MB per image.
- **Error handling:** If OCR provider is not configured or fails, returns a clear error message and the UI falls back to manual entry.

### 6.3 Environment Variables

- `OCR_PROVIDER`: Name of the OCR provider (e.g., "openai", "custom").
- `OCR_API_KEY`: API key for the OCR provider.
- `OCR_ENDPOINT`: Endpoint URL for the OCR provider.

## 7. Trackers

### 7.1 Tracker Schema

```json
{
  "id": "string (UUID v4)",
  "name": "string (e.g., 'Sodium', 'Saturated Fat')",
  "nutrientKey": "string (e.g., 'sodium', 'saturated_fat')",
  "unit": "string (e.g., 'g', 'mg')",
  "type": "max | min",
  "dailyGoal": "number",
  "isDefault": "boolean",
  "createdAt": "ISO 8601 string"
}
```

### 7.2 Tracker Usage

- Users can create any combination of trackers.
- Each tracker has a daily goal (max or min).
- Totals are calculated per day and compared against the goal.
- Status: "within goal", "exceeded" (for max), "below target" (for min).
- Optional editable templates for common tracker combinations.

## 8. Meal Planner

### 8.1 Meal Schema

```json
{
  "id": "string (UUID v4)",
  "name": "string (e.g., 'Breakfast', 'Lunch')",
  "date": "ISO 8601 date string (YYYY-MM-DD)",
  "items": [
    {
      "productId": "string",
      "productName": "string",
      "amount": "number",
      "unit": "g | ml",
      "density": "number | null (optional, for volume-to-mass conversion)"
    }
  ],
  "nutrientTotals": {
    "energy_kcal": "number | null",
    "energy_kj": "number | null",
    "fat": "number | null",
    "saturated_fat": "number | null",
    "carbs": "number | null",
    "sugars": "number | null",
    "fiber": "number | null",
    "protein": "number | null",
    "salt": "number | null",
    "sodium": "number | null",
    "vitamins": { ... },
    "minerals": { ... },
    "incomplete": "boolean (true if any nutrient is null)"
  },
  "createdAt": "ISO 8601 string",
  "updatedAt": "ISO 8601 string"
}
```

### 8.2 Scaling

- Nutrient values are scaled from the product's base (100 g or 100 ml) to the amount specified in the meal.
- Formula: `nutrientValue * (amount / baseAmount)`.
- If the product's base is in ml and the user specifies grams, the user-provided density is used: `effectiveAmount = amount / density`.
- If density is not provided and base is ml, the user is prompted to enter ml instead.

### 8.3 Totals

- Totals are calculated for all nutrients in the meal.
- If any nutrient is `null`, the total is `null` and `incomplete` is `true`.
- Rounding: 2 decimal places for most nutrients, 1 for energy in kcal.

## 9. User Interface

### 9.1 Screens

1. **Home / Dashboard:**
   - Overview of today's meal totals vs. tracker goals.
   - Quick links to "Add Product", "Plan Meal", "View Library".

2. **Scan / Add Product:**
   - Upload or take a photo of a nutrition label.
   - Display the photo alongside the extracted values.
   - User reviews and corrects each value.
   - User selects the column (per 100 g/ml or per serving).
   - User enters the product name.
   - Save to library.

3. **Product Library:**
   - List of all saved products.
   - Search and filter.
   - View/edit product details.
   - Delete product.

4. **Meal Planner:**
   - Create/edit a meal.
   - Add products with amounts (g or ml).
   - View nutrient totals for the meal.
   - Compare totals against tracker goals.
   - Save meal.

5. **Trackers:**
   - List of all trackers with daily goals.
   - Create/edit/delete trackers.
   - View daily progress (totals vs. goals).

6. **Settings:**
   - Configure OCR provider (if server is configured).
   - Export/import data.
   - Default preferences (column, units, etc.).

### 9.2 UI Constraints

- No framework, no build step.
- HTML, CSS, and ES modules only.
- Responsive design for mobile and desktop.
- Accessible (WCAG 2.1 AA).

## 10. Module Structure

### 10.1 `src/ocr/adapter.js`

- **`extractNutrition(image)`:** Calls the configured OCR provider and returns raw rows.

### 10.2 `src/ocr/normalizer.js`

- **`normalizeRows(rawRows)`:** Takes raw rows and returns normalized nutrient values.
- **`mapLabelToKey(label)`:** Maps a label to a canonical nutrient key using the synonym map.
- **`parseValue(value, unit)`:** Parses a value string, handling decimal separators and units.
- **`convertKjToKcal(kj)`:** Converts kJ to kcal (1 kcal = 4.184 kJ).
- **`convertKcalToKj(kcal)`:** Converts kcal to kJ.
- **`saltToSodium(salt)`:** Converts salt to sodium (sodium = salt / 2.5).
- **`sodiumToSalt(sodium)`:** Converts sodium to salt (salt = sodium * 2.5).
- **`scaleNutrients(nutrients, baseAmount, targetAmount)`:** Scales nutrient values from base to target amount.

### 10.3 `src/storage/products.js`

- **`getProducts()`:** Returns all products from localStorage.
- **`getProduct(id)`:** Returns a product by ID.
- **`saveProduct(product)`:** Saves a product to localStorage.
- **`updateProduct(id, updates)`:** Updates a product.
- **`deleteProduct(id)`:** Deletes a product.

### 10.4 `src/storage/trackers.js`

- **`getTrackers()`:** Returns all trackers from localStorage.
- **`getTracker(id)`:** Returns a tracker by ID.
- **`saveTracker(tracker)`:** Saves a tracker to localStorage.
- **`updateTracker(id, updates)`:** Updates a tracker.
- **`deleteTracker(id)`:** Deletes a tracker.

### 10.5 `src/storage/meals.js`

- **`getMeals()`:** Returns all meals from localStorage.
- **`getMeal(id)`:** Returns a meal by ID.
- **`saveMeal(meal)`:** Saves a meal to localStorage.
- **`updateMeal(id, updates)`:** Updates a meal.
- **`deleteMeal(id)`:** Deletes a meal.
- **`getMealsByDate(date)`:** Returns meals for a specific date.

### 10.6 `src/planner/calculator.js`

- **`calculateMealTotals(meal, products)`:** Calculates nutrient totals for a meal.
- **`calculateNutrientForAmount(product, amount, nutrientKey)`:** Calculates a single nutrient value for a given amount.

### 10.7 `src/server/index.js`

- **`startServer(port)`:** Starts the HTTP server on the given port.
- **`handleRequest(req, res)`:** Handles incoming HTTP requests.

### 10.8 `src/server/ocrHandler.js`

- **`handleExtract(req, res)`:** Handles the `/api/extract` endpoint.

### 10.9 `src/server/productHandler.js`

- **`handleProducts(req, res)`:** Handles product CRUD endpoints.

### 10.10 `src/server/trackerHandler.js`

- **`handleTrackers(req, res)`:** Handles tracker CRUD endpoints.

### 10.11 `src/server/mealHandler.js`

- **`handleMeals(req, res)`:** Handles meal CRUD endpoints.

## 11. Acceptance Criteria

### AC-1: OCR Extraction

- The app can accept a photo of a nutrition label and extract raw rows using the configured OCR provider.
- If no OCR provider is configured, the user can manually enter product information.

### AC-2: Normalization

- Raw rows are normalized to canonical nutrient values using the multilingual synonym map.
- Decimal separators (comma and period) are handled correctly.
- kJ and kcal are converted correctly (1 kcal = 4.184 kJ).
- Salt and sodium are converted correctly (sodium = salt / 2.5).
- Inconsistent values are set to `null` with a flag, never invented.

### AC-3: Schär Melto (Image 1)

- The app correctly extracts and normalizes the Schär Melto label.
- Per 100g: energy_kj=2292, energy_kcal=549, fat=33, saturated_fat=13, carbs=55, sugars=45, fiber=2.4, protein=6.8, salt=0.18, sodium=0.072.
- Per serving (30g): energy_kj=688, energy_kcal=165, fat=10, saturated_fat=3.9, carbs=16, sugars=14, fiber=0.7, protein=2.0, salt=0.05, sodium=0.02.

### AC-4: AH Juice (Image 2)

- The app correctly extracts and normalizes the AH Juice label.
- Per 100ml: energy_kj=199, energy_kcal=47, fat=0, saturated_fat=0, carbs=11, sugars=10, fiber=0.7, protein=0.4, salt=0, sodium=0, vitamin_c_mg=21.

### AC-5: AH Oil Spray (Image 3)

- The app correctly extracts and normalizes the AH Oil Spray label.
- Per 100ml: energy_kj=3404, energy_kcal=828, fat=92, saturated_fat=14, carbs=0, sugars=0, fiber=0, protein=0, salt=0, sodium=0, vitamin_e_mg=18.

### AC-6: Product Library

- Users can save products to a local library.
- Products can be viewed, edited, and deleted.
- Products are stored in localStorage and persist across sessions.

### AC-7: Meal Planner

- Users can create meals by adding products with amounts (g or ml).
- Nutrient totals are calculated correctly based on the amount specified.
- If a nutrient is `null`, the total is `null` and `incomplete` is `true`.

### AC-8: Trackers

- Users can create custom trackers with daily goals (max or min).
- Daily totals are compared against goals and status is shown.

### AC-9: Persistence

- All data (products, trackers, meals) is stored in localStorage.
- Users can export and import data as JSON.

### AC-10: No Ads, No Analytics, No Accounts

- The app is free, has no ads, no third-party analytics, and requires no accounts.
- All data stays on the user's device.

### AC-11: Server

- The app includes a minimal HTTP server built with Node's `http` module.
- The server serves static files and provides API endpoints.
- The OCR endpoint is configurable via environment variables.

### AC-12: UI

- The UI is built with HTML, CSS, and ES modules (no framework, no build step).
- The UI is responsive and accessible.

## 12. Edge Cases and Error Handling

- **Unclear photo:** If OCR returns no rows or very few rows, the user is prompted to retake the photo or enter manually.
- **Inconsistent values:** If kJ and kcal are inconsistent (beyond ±5% tolerance), both are set to `null` with a flag.
- **Below detection limit:** Values like `<0,1` are set to `null` with a flag `belowDetectionLimit: true`.
- **Missing nutrients:** If a nutrient is not present on the label, it is set to `null`.
- **Volume vs. mass:** If a product's base is in ml and the user specifies grams, the user is prompted to enter ml or provide a density.
- **OCR failure:** If the OCR provider fails or is not configured, the user is shown a clear error message and can enter data manually.

## 13. Out of Scope

- User accounts and cloud sync.
- Barcode scanning.
- Pre-built product database.
- Recipe sharing or social features.

## 14. Non-Functional Requirements

- **Free and ad-free:** No ads, no paid features.
- **No third-party analytics:** No analytics of any kind.
- **No accounts:** No registration or login required.
- **Local data only:** All data is stored on the user's device.
- **Offline-capable:** The app works offline once loaded (PWA optional but not required).
- **Responsive:** Works on mobile and desktop.
- **Accessible:** WCAG 2.1 AA compliance.