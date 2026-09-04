const crypto = require("crypto");
const Razorpay = require("razorpay");
const { checkouts, sessions, id } = require("../data/store");
const { getOffer } = require("./negotiationService");

let razorpay = null;

function hasRazorpayConfig() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function getRazorpay() {
  if (!hasRazorpayConfig()) return null;
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }
  return razorpay;
}

async function createCheckout({ sessionId, offer_id }) {
  const offer = getOffer(offer_id);

  if (!offer) {
    return { status: "rejected", reason: "OFFER_NOT_FOUND" };
  }

  if (offer.session_id !== sessionId) {
    return { status: "rejected", reason: "OFFER_SESSION_MISMATCH" };
  }

  if (!offer.authorized || offer.status !== "accepted") {
    return { status: "rejected", reason: "OFFER_NOT_AUTHORIZED" };
  }

  if (new Date(offer.expires_at).getTime() < Date.now()) {
    return { status: "rejected", reason: "OFFER_EXPIRED" };
  }

  const session = sessions.get(sessionId);
  if (!session || session.accepted_offer_id !== offer_id) {
    return {
      status: "rejected",
      reason: "BUYER_ACCEPTANCE_REQUIRED"
    };
  }

  // Critical security property:
  // The AI never supplies the payment amount. It is calculated from the
  // server-side authorized offer only.
  const amountPaise = Math.round(offer.total_amount * 100);
  const checkoutId = id("checkout");

  if (!hasRazorpayConfig()) {
    if (String(process.env.DEMO_MODE).toLowerCase() !== "true") {
      return {
        status: "error",
        reason: "RAZORPAY_NOT_CONFIGURED"
      };
    }

    const demoOrder = {
      id: `order_demo_${crypto.randomUUID()}`,
      amount: amountPaise,
      currency: offer.currency,
      receipt: checkoutId,
      status: "created"
    };

    const checkout = {
      checkout_id: checkoutId,
      session_id: sessionId,
      offer_id,
      order_id: demoOrder.id,
      amount: amountPaise,
      currency: offer.currency,
      payment_status: "created",
      demo: true,
      created_at: new Date().toISOString()
    };

    checkouts.set(checkoutId, checkout);
    session.checkout_id = checkoutId;
    session.payment_status = "created";

    return {
      status: "checkout_created",
      demo: true,
      ...checkout,
      razorpay_key_id: null
    };
  }

  const order = await getRazorpay().orders.create({
    amount: amountPaise,
    currency: offer.currency,
    receipt: checkoutId,
    notes: {
      mpact_session_id: sessionId,
      mpact_offer_id: offer_id,
      product_id: offer.product_id
    }
  });

  const checkout = {
    checkout_id: checkoutId,
    session_id: sessionId,
    offer_id,
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    payment_status: "created",
    demo: false,
    created_at: new Date().toISOString()
  };

  checkouts.set(checkoutId, checkout);
  session.checkout_id = checkoutId;
  session.payment_status = "created";

  return {
    status: "checkout_created",
    ...checkout,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID
  };
}

function getCheckout(checkoutId) {
  return checkouts.get(checkoutId) || null;
}

function verifyPaymentSignature({ order_id, payment_id, signature }) {
  if (!process.env.RAZORPAY_KEY_SECRET) {
    return { ok: false, reason: "RAZORPAY_NOT_CONFIGURED" };
  }

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${order_id}|${payment_id}`)
    .digest("hex");

  const ok =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  return ok
    ? { ok: true }
    : { ok: false, reason: "INVALID_PAYMENT_SIGNATURE" };
}

function applyPaymentEvent({ orderId, paymentId, status, eventId }) {
  const checkout = [...checkouts.values()].find((c) => c.order_id === orderId);
  if (!checkout) return { status: "ignored", reason: "ORDER_NOT_FOUND" };

  checkout.payment_id = paymentId || checkout.payment_id;
  checkout.payment_status = status;
  checkout.last_event_id = eventId || checkout.last_event_id;
  checkout.updated_at = new Date().toISOString();

  const session = sessions.get(checkout.session_id);
  if (session) session.payment_status = status;

  return { status: "updated", checkout };
}

module.exports = {
  createCheckout,
  getCheckout,
  verifyPaymentSignature,
  applyPaymentEvent,
  hasRazorpayConfig
};
