const crypto = require("crypto");

const catalog = [
  {
    id: "prod_headphones_001",
    name: "M-PACT AirBeat Pro Wireless Headphones",
    description: "Wireless over-ear headphones with ANC, 40-hour battery and low-latency mode.",
    price: 3000,
    currency: "INR",
    inventory: 25,
    category: "audio"
  },
  {
    id: "prod_keyboard_001",
    name: "M-PACT MechKey 75 Mechanical Keyboard",
    description: "75% mechanical keyboard with hot-swappable switches and RGB lighting.",
    price: 4200,
    currency: "INR",
    inventory: 18,
    category: "keyboard"
  },
  {
    id: "prod_mouse_001",
    name: "M-PACT Glide Wireless Mouse",
    description: "Lightweight wireless mouse with adjustable DPI and USB-C charging.",
    price: 1800,
    currency: "INR",
    inventory: 40,
    category: "mouse"
  },
  {
    id: "prod_monitor_001",
    name: "M-PACT Vision 24 FHD Monitor",
    description: "24-inch Full HD IPS monitor with 100Hz refresh rate and HDMI connectivity.",
    price: 8500,
    currency: "INR",
    inventory: 12,
    category: "monitor"
  }
];

const policy = {
  currency: "INR",
  negotiation_enabled: true,
  max_discount_percent: 10,
  min_order_quantity: 1,
  max_order_quantity: 10,
  max_negotiation_rounds: 3,
  offer_expiry_minutes: 30
};

const sessions = new Map();
const offers = new Map();
const checkouts = new Map();
const webhookEvents = new Set();

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

module.exports = {
  catalog,
  policy,
  sessions,
  offers,
  checkouts,
  webhookEvents,
  id
};
