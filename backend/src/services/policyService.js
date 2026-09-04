const { policy, catalog } = require("../data/store");

function getMerchantPolicy() {
  return {
    ...policy,
    source: "merchant_policy",
    authoritative: true
  };
}

function getProduct(productId) {
  return catalog.find((p) => p.id === productId) || null;
}

function searchCatalog({ query = "", max_price = null, quantity = null }) {
  const q = String(query).trim().toLowerCase();

  return catalog
    .filter((p) => {
      const searchable = `${p.name} ${p.description} ${p.category}`.toLowerCase();
      const matchesQuery = !q || searchable.includes(q) ||
        q.split(/\s+/).some((word) => word.length > 2 && searchable.includes(word));
      const matchesPrice = max_price == null || p.price <= Number(max_price);
      const matchesQty = quantity == null || p.inventory >= Number(quantity);
      return matchesQuery && matchesPrice && matchesQty;
    })
    .map(({ id, name, description, price, currency, inventory, category }) => ({
      id, name, description, price, currency, inventory, category
    }));
}

function validateQuantity(quantity) {
  const q = Number(quantity);
  if (!Number.isInteger(q)) {
    return { ok: false, reason: "QUANTITY_MUST_BE_INTEGER" };
  }
  if (q < policy.min_order_quantity || q > policy.max_order_quantity) {
    return {
      ok: false,
      reason: "QUANTITY_OUT_OF_RANGE",
      min_order_quantity: policy.min_order_quantity,
      max_order_quantity: policy.max_order_quantity
    };
  }
  return { ok: true };
}

function validateOffer({ product, quantity, offeredUnitPrice }) {
  if (!product) {
    return { ok: false, reason: "PRODUCT_NOT_FOUND" };
  }

  const quantityResult = validateQuantity(quantity);
  if (!quantityResult.ok) return quantityResult;

  if (quantity > product.inventory) {
    return {
      ok: false,
      reason: "INSUFFICIENT_INVENTORY",
      available_inventory: product.inventory
    };
  }

  const price = Number(offeredUnitPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: "INVALID_OFFER_PRICE" };
  }

  const discountPercent = ((product.price - price) / product.price) * 100;

  if (discountPercent < 0) {
    return {
      ok: false,
      reason: "OFFER_ABOVE_BASE_PRICE",
      base_price: product.price
    };
  }

  if (discountPercent > policy.max_discount_percent + 1e-9) {
    return {
      ok: false,
      reason: "OFFER_EXCEEDS_DISCOUNT_LIMIT",
      requested_discount_percent: Number(discountPercent.toFixed(2)),
      max_discount_percent: policy.max_discount_percent,
      minimum_allowed_unit_price: Number(
        (product.price * (1 - policy.max_discount_percent / 100)).toFixed(2)
      )
    };
  }

  return {
    ok: true,
    discountPercent: Number(discountPercent.toFixed(2))
  };
}

module.exports = {
  getMerchantPolicy,
  getProduct,
  searchCatalog,
  validateOffer,
  validateQuantity
};
