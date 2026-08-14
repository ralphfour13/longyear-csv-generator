import { retryShopifyAPI } from '../../utils/retry';

/**
 * Product Cost Updater
 *
 * Reads the Shopify product catalog (variant SKU + inventory item) and writes the
 * unit cost ("Cost per item") on each variant's InventoryItem. Used to push COGS
 * pulled from Cin7 into Shopify so native margin/profit reporting stays accurate.
 *
 * Uses the GraphQL Admin API (cleaner than REST for paginated variant enumeration
 * and the cost mutation). API version matches the rest of the app (2024-10).
 */

const API_VERSION = '2024-10';

export interface ShopifyVariant {
  sku: string | null;
  inventoryItemId: string;
  /** Current unit cost as a string (e.g. "12.50"), or null if unset */
  currentCost: string | null;
  productTitle: string;
  productStatus: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * Run a GraphQL operation against the Shopify Admin API for a shop.
 */
async function shopifyGraphQL<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  context: string,
): Promise<T> {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  return await retryShopifyAPI(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${context} failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const body = (await response.json()) as GraphQLResponse<T>;

    if (body.errors && body.errors.length > 0) {
      // Throw so retryShopifyAPI can decide based on message (e.g. throttled)
      throw new Error(
        `${context} GraphQL errors: ${body.errors.map((e) => e.message).join('; ')}`,
      );
    }

    if (!body.data) {
      throw new Error(`${context}: empty GraphQL response`);
    }

    return body.data;
  }, context);
}

const VARIANTS_QUERY = `
query Variants($cursor: String) {
  productVariants(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sku
      inventoryItem { id unitCost { amount } }
      product { status title }
    }
  }
}`;

interface VariantsQueryData {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      sku: string | null;
      inventoryItem: { id: string; unitCost: { amount: string } | null } | null;
      product: { status: string; title: string } | null;
    }>;
  };
}

/**
 * Enumerate all ACTIVE product variants in the shop.
 *
 * Paginates the full catalog (250/page). Variants whose product is not ACTIVE,
 * or that have no inventory item, are excluded. Variants with an empty SKU are
 * still returned (with sku === null) so the caller can report them as skipped.
 *
 * @param onProgress - optional callback invoked with the running variant count
 */
export async function fetchActiveVariants(
  shop: string,
  accessToken: string,
  onProgress?: (count: number) => void | Promise<void>,
): Promise<ShopifyVariant[]> {
  const variants: ShopifyVariant[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: VariantsQueryData = await shopifyGraphQL<VariantsQueryData>(
      shop,
      accessToken,
      VARIANTS_QUERY,
      { cursor },
      'Fetch product variants',
    );

    for (const node of data.productVariants.nodes) {
      // Only active products; skip variants with no inventory item to update
      if (node.product?.status !== 'ACTIVE' || !node.inventoryItem) {
        continue;
      }

      variants.push({
        sku: node.sku && node.sku.trim() !== '' ? node.sku.trim() : null,
        inventoryItemId: node.inventoryItem.id,
        currentCost: node.inventoryItem.unitCost?.amount ?? null,
        productTitle: node.product?.title ?? '(untitled)',
        productStatus: node.product?.status ?? 'UNKNOWN',
      });
    }

    if (onProgress) {
      await onProgress(variants.length);
    }

    hasNextPage = data.productVariants.pageInfo.hasNextPage;
    cursor = data.productVariants.pageInfo.endCursor;
  }

  return variants;
}

const VARIANTS_BY_SKU_QUERY = `
query VariantsBySku($query: String!, $cursor: String) {
  productVariants(first: 100, query: $query, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sku
      inventoryItem { id unitCost { amount } }
      product { status title }
    }
  }
}`;

/**
 * Build a Shopify search term that matches a single exact SKU.
 *
 * Wraps the value in single quotes (phrase query) and escapes backslashes and
 * single quotes. Asterisks are escaped too so a SKU containing `*` can't act as a
 * wildcard and broaden the match. The query is only used to FETCH candidate
 * variants — the authoritative exact (case-insensitive) match happens in
 * pullCogsForSkus — but neutralizing `*` keeps the candidate set small.
 */
function escapeSkuTerm(sku: string): string {
  const escaped = sku
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\*/g, '\\*');
  return `sku:'${escaped}'`;
}

/**
 * Fetch variants for a specific set of SKUs (no full-catalog scan).
 *
 * Used by the one-off COGS pull. Unlike fetchActiveVariants this does NOT filter
 * by product status — a targeted pull should update whatever variant matches the
 * SKU. Returns one ShopifyVariant per matching variant; SKUs with no match simply
 * won't appear (the caller reports those as "not found in Shopify").
 */
export async function fetchVariantsBySkus(
  shop: string,
  accessToken: string,
  skus: string[],
): Promise<ShopifyVariant[]> {
  const variants: ShopifyVariant[] = [];

  // Shopify search query length is bounded; query SKUs in modest chunks.
  const CHUNK = 25;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK);
    const query = chunk.map(escapeSkuTerm).join(' OR ');

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: VariantsQueryData = await shopifyGraphQL<VariantsQueryData>(
        shop,
        accessToken,
        VARIANTS_BY_SKU_QUERY,
        { query, cursor },
        'Fetch product variants by SKU',
      );

      for (const node of data.productVariants.nodes) {
        if (!node.inventoryItem) {
          continue;
        }
        variants.push({
          sku: node.sku && node.sku.trim() !== '' ? node.sku.trim() : null,
          inventoryItemId: node.inventoryItem.id,
          currentCost: node.inventoryItem.unitCost?.amount ?? null,
          productTitle: node.product?.title ?? '(untitled)',
          productStatus: node.product?.status ?? 'UNKNOWN',
        });
      }

      hasNextPage = data.productVariants.pageInfo.hasNextPage;
      cursor = data.productVariants.pageInfo.endCursor;
    }
  }

  return variants;
}

/**
 * Richer per-variant detail for the inventory/item export (Products with Orders).
 * Distinct from ShopifyVariant (used by the COGS push) because it also needs
 * price, weight, and on-hand inventory.
 */
export interface ShopifyVariantDetail {
  sku: string | null;
  productTitle: string;
  price: string | null;            // variant.price
  weight: number | null;           // inventoryItem.measurement.weight.value
  weightUnit: string | null;       // e.g. "POUNDS", "GRAMS"
  inventoryAvailable: number | null; // variant.inventoryQuantity (sum across locations)
  unitCost: string | null;         // Shopify "Cost per item" (inventoryItem.unitCost)
}

const VARIANT_DETAILS_BY_SKU_QUERY = `
query VariantDetailsBySku($query: String!, $cursor: String) {
  productVariants(first: 100, query: $query, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sku
      price
      inventoryQuantity
      inventoryItem {
        unitCost { amount }
        measurement { weight { value unit } }
      }
      product { title }
    }
  }
}`;

interface VariantDetailsQueryData {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      sku: string | null;
      price: string | null;
      inventoryQuantity: number | null;
      inventoryItem: {
        unitCost: { amount: string } | null;
        measurement: { weight: { value: number; unit: string } | null } | null;
      } | null;
      product: { title: string } | null;
    }>;
  };
}

/**
 * Fetch price / weight / on-hand inventory / Shopify unit cost for a set of SKUs.
 *
 * Returns a Map keyed by lower-cased SKU for case-insensitive lookup. SKUs with no
 * matching variant simply won't appear in the map (caller treats as blanks/0).
 */
export async function fetchVariantDetailsBySkus(
  shop: string,
  accessToken: string,
  skus: string[],
): Promise<Map<string, ShopifyVariantDetail>> {
  const bySku = new Map<string, ShopifyVariantDetail>();

  // Shopify search query length is bounded; query SKUs in modest chunks.
  const CHUNK = 25;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK);
    const query = chunk.map(escapeSkuTerm).join(' OR ');

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: VariantDetailsQueryData = await shopifyGraphQL<VariantDetailsQueryData>(
        shop,
        accessToken,
        VARIANT_DETAILS_BY_SKU_QUERY,
        { query, cursor },
        'Fetch variant details by SKU',
      );

      for (const node of data.productVariants.nodes) {
        const sku = node.sku && node.sku.trim() !== '' ? node.sku.trim() : null;
        if (!sku) {
          continue;
        }
        bySku.set(sku.toLowerCase(), {
          sku,
          productTitle: node.product?.title ?? '',
          price: node.price ?? null,
          weight: node.inventoryItem?.measurement?.weight?.value ?? null,
          weightUnit: node.inventoryItem?.measurement?.weight?.unit ?? null,
          inventoryAvailable: node.inventoryQuantity ?? null,
          unitCost: node.inventoryItem?.unitCost?.amount ?? null,
        });
      }

      hasNextPage = data.productVariants.pageInfo.hasNextPage;
      cursor = data.productVariants.pageInfo.endCursor;
    }
  }

  return bySku;
}

const PRODUCT_METAFIELD_BY_SKU_QUERY = `
query ProductMetafieldBySku($query: String!, $cursor: String, $namespace: String!, $key: String!) {
  productVariants(first: 100, query: $query, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sku
      product {
        metafield(namespace: $namespace, key: $key) { value }
      }
    }
  }
}`;

interface ProductMetafieldQueryData {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      sku: string | null;
      product: { metafield: { value: string } | null } | null;
    }>;
  };
}

/**
 * Fetch a single PRODUCT metafield value for a set of variant SKUs.
 *
 * Used to surface the DonorPerfect "G/L Account" product metafield
 * (namespace `donorperfect`, key `gl_account`) on the order exports.
 *
 * Returns a Map keyed by lower-cased SKU → metafield value. SKUs whose product
 * has no such metafield (or no matching variant) simply won't appear in the map.
 */
export async function fetchProductMetafieldBySkus(
  shop: string,
  accessToken: string,
  skus: string[],
  namespace: string,
  key: string,
): Promise<Map<string, string>> {
  const bySku = new Map<string, string>();

  // Shopify search query length is bounded; query SKUs in modest chunks.
  const CHUNK = 25;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK);
    const query = chunk.map(escapeSkuTerm).join(' OR ');

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: ProductMetafieldQueryData = await shopifyGraphQL<ProductMetafieldQueryData>(
        shop,
        accessToken,
        PRODUCT_METAFIELD_BY_SKU_QUERY,
        { query, cursor, namespace, key },
        'Fetch product metafield by SKU',
      );

      for (const node of data.productVariants.nodes) {
        const sku = node.sku && node.sku.trim() !== '' ? node.sku.trim() : null;
        const value = node.product?.metafield?.value;
        if (sku && value != null && value !== '') {
          bySku.set(sku.toLowerCase(), value);
        }
      }

      hasNextPage = data.productVariants.pageInfo.hasNextPage;
      cursor = data.productVariants.pageInfo.endCursor;
    }
  }

  return bySku;
}

const UPDATE_COST_MUTATION = `
mutation SetCost($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem { id unitCost { amount } }
    userErrors { message }
  }
}`;

interface UpdateCostData {
  inventoryItemUpdate: {
    inventoryItem: { id: string; unitCost: { amount: string } | null } | null;
    userErrors: Array<{ message: string }>;
  };
}

/**
 * Set the unit cost on a single inventory item.
 *
 * @throws Error if the mutation returns userErrors (caller records + continues)
 */
export async function updateInventoryItemCost(
  shop: string,
  accessToken: string,
  inventoryItemId: string,
  cost: number,
): Promise<void> {
  const data = await shopifyGraphQL<UpdateCostData>(
    shop,
    accessToken,
    UPDATE_COST_MUTATION,
    { id: inventoryItemId, input: { cost } },
    'Update inventory item cost',
  );

  const userErrors = data.inventoryItemUpdate.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join('; '));
  }
}
