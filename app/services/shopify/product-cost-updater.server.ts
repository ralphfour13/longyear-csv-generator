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
