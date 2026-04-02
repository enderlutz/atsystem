/**
 * Shared data and helpers for proposal pages (V1 and V2).
 */

// ─── Color CDN ───────────────────────────────────────────────────────
export const CDN = "https://zmzmfokcafbvrszjwwrq.supabase.co/storage/v1/object/public/fence-colors";

export const SIGNATURE_COLORS = [
  { id: 7,  name: "Cedar Solid",   brand: "Signature", src: `${CDN}/cedar-solid-legacy.jpg`   },
  { id: 8,  name: "October Brown", brand: "Signature", src: `${CDN}/october-brown-legacy.jpg` },
  { id: 9,  name: "Black Alder",   brand: "Signature", src: `${CDN}/black-alder-legacy.jpg`   },
  { id: 10, name: "Black",         brand: "Signature", src: `${CDN}/black-legacy.jpg`          },
  { id: 11, name: "Redwood",       brand: "Signature", src: `${CDN}/redwood-legacy.jpg`        },
  { id: 12, name: "Dark Grey",     brand: "Signature", src: `${CDN}/dark-grey-legacy.jpg`      },
];

export const LEGACY_COLORS = [
  { id: 1, name: "Natural Tone",  brand: "Legacy", src: `${CDN}/natural-tone-signature.jpg` },
  { id: 2, name: "Simply Cedar",  brand: "Legacy", src: `${CDN}/simply-cedar-signature.jpg` },
  { id: 3, name: "Light Grey",    brand: "Legacy", src: `${CDN}/light-grey-signature.jpg`   },
  { id: 4, name: "Sandal",        brand: "Legacy", src: `${CDN}/sandal-signature.jpg`       },
  { id: 5, name: "Canyon Brown",  brand: "Legacy", src: `${CDN}/canyon-brown-signature.jpg` },
  { id: 6, name: "Redwood",       brand: "Legacy", src: `${CDN}/redwood-signature.jpg`      },
];

export const ALL_STAIN_COLORS = [...SIGNATURE_COLORS, ...LEGACY_COLORS];

export const HOA_COLORS = [
  { name: "Adobe", hex: "#9A6B4F", available_in: ["semi-transparent", "solid"] },
  { name: "Antique Burgundy", hex: "#5A2E36", available_in: ["semi-transparent"] },
  { name: "Autumn Fog", hex: "#AEB6B7", available_in: ["semi-transparent", "solid"] },
  { name: "Autumn Russet", hex: "#A45B3B", available_in: ["semi-transparent"] },
  { name: "Brickwood", hex: "#8B3D32", available_in: ["semi-transparent", "solid"] },
  { name: "Brown", hex: "#6B4F3A", available_in: ["semi-transparent", "solid"] },
  { name: "Cedar", hex: "#9C6A3D", available_in: ["semi-transparent", "solid"] },
  { name: "Cedar Naturaltone", hex: "#A66B3E", available_in: ["transparent", "semi-transparent"] },
  { name: "Cilantro", hex: "#666944", available_in: ["semi-transparent", "solid"] },
  { name: "Classic Buff", hex: "#E1D2B6", available_in: ["semi-transparent", "solid"] },
  { name: "Clay Angel", hex: "#CBB8A8", available_in: ["semi-transparent", "solid"] },
  { name: "Coffee Gelato", hex: "#B8896B", available_in: ["semi-transparent", "solid"] },
  { name: "Corner Cafe", hex: "#B88654", available_in: ["semi-transparent", "solid"] },
  { name: "Cowboy Boots", hex: "#65534A", available_in: ["semi-transparent", "solid"] },
  { name: "Cowboy Suede", hex: "#76422D", available_in: ["semi-transparent"] },
  { name: "Desert Sand", hex: "#D7C3AA", available_in: ["semi-transparent", "solid"] },
  { name: "Dust Bunny", hex: "#CCB9AC", available_in: ["semi-transparent", "solid"] },
  { name: "Filtered Shade", hex: "#CBC9C4", available_in: ["semi-transparent", "solid"] },
  { name: "Forest Canopy", hex: "#2F3837", available_in: ["semi-transparent", "solid"] },
  { name: "Frappe", hex: "#BDB6AA", available_in: ["semi-transparent", "solid"] },
  { name: "Gallery Grey", hex: "#C2B5A7", available_in: ["semi-transparent", "solid"] },
  { name: "Garden Ochre", hex: "#B9803C", available_in: ["semi-transparent", "solid"] },
  { name: "Gravity", hex: "#C3C6C7", available_in: ["semi-transparent", "solid"] },
  { name: "Gray Brook", hex: "#AEBABD", available_in: ["semi-transparent", "solid"] },
  { name: "Greige", hex: "#B7AD9F", available_in: ["semi-transparent", "solid"] },
  { name: "Hazy Stratus", hex: "#A1A09B", available_in: ["semi-transparent", "solid"] },
  { name: "Heirloom Red", hex: "#7B2E2E", available_in: ["semi-transparent", "solid"] },
  { name: "High-Speed Steel", hex: "#616467", available_in: ["semi-transparent", "solid"] },
  { name: "Honey Gold", hex: "#C8A15A", available_in: ["transparent"] },
  { name: "Hopsack", hex: "#D1BEAA", available_in: ["semi-transparent", "solid"] },
  { name: "Khaki", hex: "#A39274", available_in: ["semi-transparent", "solid"] },
  { name: "Kings Canyon", hex: "#7A5B47", available_in: ["semi-transparent", "solid"] },
  { name: "Midnight Shadow", hex: "#33353A", available_in: ["semi-transparent", "solid"] },
  { name: "Monticello Tan", hex: "#9B8F7B", available_in: ["semi-transparent", "solid"] },
  { name: "Mountain Smoke", hex: "#8A867F", available_in: ["semi-transparent", "solid"] },
  { name: "Mudslide", hex: "#6A5A4F", available_in: ["semi-transparent", "solid"] },
  { name: "Natural Cork", hex: "#895C3D", available_in: ["semi-transparent", "solid"] },
  { name: "Navajo Horizon", hex: "#A08173", available_in: ["semi-transparent", "solid"] },
  { name: "Notre Dame", hex: "#7F8587", available_in: ["semi-transparent", "solid"] },
  { name: "Nuance", hex: "#C3BEB6", available_in: ["semi-transparent", "solid"] },
  { name: "Pale Powder", hex: "#CDAB92", available_in: ["semi-transparent", "solid"] },
  { name: "Pitch Cobalt", hex: "#293944", available_in: ["semi-transparent", "solid"] },
  { name: "Porcelain Shale", hex: "#C0C0BB", available_in: ["semi-transparent", "solid"] },
  { name: "Quail Egg", hex: "#EAE2D5", available_in: ["semi-transparent", "solid"] },
  { name: "Redwood", hex: "#8B3F2B", available_in: ["semi-transparent", "solid"] },
  { name: "Reindeer", hex: "#8B8061", available_in: ["semi-transparent", "solid"] },
  { name: "Riverbeds Edge", hex: "#7F7A73", available_in: ["semi-transparent", "solid"] },
  { name: "Rusticanna", hex: "#8A523D", available_in: ["semi-transparent", "solid"] },
  { name: "Safari Brown", hex: "#5C4A3A", available_in: ["semi-transparent", "solid"] },
  { name: "Sahara Sands", hex: "#E0C6AE", available_in: ["semi-transparent", "solid"] },
  { name: "Savannah Red", hex: "#8A3C2E", available_in: ["semi-transparent", "solid"] },
  { name: "Scented Candle", hex: "#846B59", available_in: ["semi-transparent", "solid"] },
  { name: "Seafoam Storm", hex: "#939A91", available_in: ["semi-transparent", "solid"] },
  { name: "Sharkfin", hex: "#7C878B", available_in: ["semi-transparent", "solid"] },
  { name: "Stampede", hex: "#6C5A47", available_in: ["semi-transparent", "solid"] },
  { name: "Standing Still", hex: "#8C6343", available_in: ["semi-transparent", "solid"] },
  { name: "Timber Dust", hex: "#BAA693", available_in: ["semi-transparent", "solid"] },
  { name: "Universal Umber", hex: "#9A7E65", available_in: ["semi-transparent", "solid"] },
  { name: "Very Black", hex: "#2F3238", available_in: ["semi-transparent", "solid"] },
  { name: "Warm Buff", hex: "#D1B390", available_in: ["semi-transparent", "solid"] },
  { name: "Wedgwood Blue", hex: "#7A92A8", available_in: ["semi-transparent", "solid"] },
];

// ─── Package Tiers ───────────────────────────────────────────────────
export const TIER_INFO = [
  {
    key: "essential" as const,
    label: "Essential Seal\u2122",
    badge: null,
    features: ["Clear natural wood refresh", "Slows moisture & sun damage", "Most affordable option"],
  },
  {
    key: "signature" as const,
    label: "Signature Finish\u2122",
    badge: "Most Popular",
    features: ["Full, even coverage for a flawless finish", "Perfect for Texas heat & weather", "Covers imperfections & uneven wood tones", "Chosen by 8 out of 10 homeowners"],
  },
  {
    key: "legacy" as const,
    label: "Legacy Finish\u2122",
    badge: "\u2b50 Premium",
    features: ["Let your wood grain shine", "Brighter, more vibrant color options", "Showcases the natural beauty of your wood", "The premium choice for design-focused homeowners"],
  },
];

// ─── Price Helpers ───────────────────────────────────────────────────
export function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
export function fmtFull(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtMonthly(n: number) { return `~${fmt(Math.ceil(n / 21))}/mo`; }
export function strikethrough(n: number) { return fmt(Math.round(n / 0.80)); }

export function formatDateDisplay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
export function formatShortDateDisplay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function getColorsForTier(tier: "essential" | "signature" | "legacy") {
  if (tier === "signature") return SIGNATURE_COLORS;
  if (tier === "legacy") return LEGACY_COLORS;
  return [];
}

export function getHoaColorsForTier(tier: "essential" | "signature" | "legacy") {
  if (tier === "signature") return HOA_COLORS.filter(c => c.available_in.includes("semi-transparent"));
  if (tier === "legacy") return HOA_COLORS.filter(c => c.available_in.includes("solid"));
  return [];
}
