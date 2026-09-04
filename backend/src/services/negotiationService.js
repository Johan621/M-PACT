const { offers, sessions, id } = require("../data/store");
const {
  getMerchantPolicy,
  getProduct,
  validateOffer
} = require("./policyService");

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      session_id: sessionId,
      negotiation_round: 0,
      offer_ids: [],
      accepted_offer_id: null,
      checkout_id: null,
      payment_status: "not_created"
    });
  }
  return sessions.get(sessionId);
}

function submitOffer({ sessionId, product_id, quantity, offered_unit_price, currency }) {
  const product = getProduct(product_id);
  const merchantPolicy = getMerchantPolicy();

  if (!product) {
    return { status: "rejected", reason: "PRODUCT_NOT_FOUND" };
  }

  if (currency !== merchantPolicy.currency) {
    return {
      status: "rejected",
      reason: "UNSUPPORTED_CURRENCY",
      supported_currency: merchantPolicy.currency
    };
  }

  const session = getSession(sessionId);

  if (session.negotiation_round >= merchantPolicy.max_negotiation_rounds) {
    return {
      status: "rejected",
      reason: "MAX_NEGOTIATION_ROUNDS_REACHED",
      max_negotiation_rounds: merchantPolicy.max_negotiation_rounds
    };
  }

  const validation = validateOffer({
    product,
    quantity,
    offeredUnitPrice: offered_unit_price
  });

  session.negotiation_round += 1;

  if (!validation.ok) {
    session.last_rejection = {
      reason: validation.reason,
      at: new Date().toISOString()
    };
    return {
      status: "rejected",
      ...validation,
      round: session.negotiation_round
    };
  }

  const offerId = id("offer");
  const expiresAt = new Date(
    Date.now() + merchantPolicy.offer_expiry_minutes * 60 * 1000
  ).toISOString();

  const offer = {
    offer_id: offerId,
    session_id: sessionId,
    product_id,
    product_name: product.name,
    quantity: Number(quantity),
    base_unit_price: product.price,
    offered_unit_price: Number(offered_unit_price),
    discount_percent: validation.discountPercent,
    currency,
    total_amount: Number((Number(offered_unit_price) * Number(quantity)).toFixed(2)),
    status: "accepted",
    authorized: true,
    expires_at: expiresAt,
    created_at: new Date().toISOString()
  };

  offers.set(offerId, offer);
  session.offer_ids.push(offerId);

  return {
    status: "accepted",
    ...offer
  };
}

function acceptOffer({ sessionId, offer_id }) {
  const offer = offers.get(offer_id);

  if (!offer) return { status: "rejected", reason: "OFFER_NOT_FOUND" };
  if (offer.session_id !== sessionId) {
    return { status: "rejected", reason: "OFFER_SESSION_MISMATCH" };
  }
  if (offer.status !== "accepted" || !offer.authorized) {
    return { status: "rejected", reason: "OFFER_NOT_AUTHORIZED" };
  }
  if (new Date(offer.expires_at).getTime() < Date.now()) {
    offer.status = "expired";
    return { status: "rejected", reason: "OFFER_EXPIRED" };
  }

  const session = getSession(sessionId);
  session.accepted_offer_id = offer_id;

  return {
    status: "accepted",
    offer_id,
    total_amount: offer.total_amount,
    currency: offer.currency
  };
}

function getOffer(offerId) {
  return offers.get(offerId) || null;
}

module.exports = {
  getSession,
  submitOffer,
  acceptOffer,
  getOffer
};
