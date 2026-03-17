"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, type ProposalData, type ScheduleSlot } from "@/lib/api";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#F8F9FA",
  card: "#FFFFFF",
  cardLight: "#F0F2F5",
  gold: "#1C2235",
  goldDark: "#111827",
  goldLight: "#374151",
  cream: "#111827",
  creamDark: "#374151",
  textMuted: "#9CA3AF",
  border: "#E5E7EB",
  borderSubtle: "#F3F4F6",
  green: "#16A34A",
  red: "#DC2626",
};

// ─── Color data ───────────────────────────────────────────────────────────────
const MAIN_COLORS = [
  { id: 1, name: "Cordovan Brown",  brand: "Ready Seal", hex: "#6B3A2A" },
  { id: 2, name: "Natural Cedar",   brand: "Ready Seal", hex: "#C4883C" },
  { id: 3, name: "Dark Walnut",     brand: "Ready Seal", hex: "#3E2723" },
  { id: 4, name: "Honey Gold",      brand: "Ready Seal", hex: "#D4A64A" },
  { id: 5, name: "Canyon Brown",    brand: "Ready Seal", hex: "#8B5E3C" },
  { id: 6, name: "Redwood",         brand: "Ready Seal", hex: "#A52A2A" },
];

const PALETTE_COLORS = [
  { id: 101, name: "Sahara Sands",      hex: "#C2A06E" },
  { id: 102, name: "Autumn Russet",     hex: "#8B3A1A" },
  { id: 103, name: "October Brown",     hex: "#6E3B1F" },
  { id: 104, name: "Timber Dust",       hex: "#A08060" },
  { id: 105, name: "Coffee Gelato",     hex: "#7B5230" },
  { id: 106, name: "Navajo Horizon",    hex: "#B8905A" },
  { id: 107, name: "Cowboy Suede",      hex: "#9E7060" },
  { id: 108, name: "Brickwood",         hex: "#7A3B28" },
  { id: 109, name: "Heirloom Red",      hex: "#8B2020" },
  { id: 110, name: "Antique Burgundy",  hex: "#6B1A2A" },
  { id: 111, name: "Standing Still",    hex: "#A0906A" },
  { id: 112, name: "Natural Cork",      hex: "#C4A870" },
  { id: 113, name: "Classic Buff",      hex: "#D4C090" },
  { id: 114, name: "Desert Sand",       hex: "#D2B48C" },
  { id: 115, name: "Gallery Grey",      hex: "#9090A0" },
  { id: 116, name: "Mountain Smoke",    hex: "#7A8090" },
  { id: 117, name: "Sharkfin",          hex: "#708090" },
  { id: 118, name: "Forest Canopy",     hex: "#4A6040" },
  { id: 119, name: "Midnight Shadow",   hex: "#2C2C3A" },
  { id: 120, name: "Wedgewood Blue",    hex: "#5B7FA6" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtFull(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtMonthly(n: number) { return `~${fmt(Math.ceil(n / 21))}/mo`; }
function strikethrough(n: number) { return fmt(Math.round(n / 0.80)); }

function getPromoDeadline(): string {
  const d = new Date();
  const day = d.getDate();
  if (day <= 22) return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return new Date(d.getFullYear(), d.getMonth() + 2, 0).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function formatDateDisplay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatShortDateDisplay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function generateICS(customerName: string, address: string, dateStr: string, tier: string): string {
  const d = new Date(dateStr + "T09:00:00");
  const end = new Date(dateStr + "T13:00:00");
  const pad = (n: number) => String(n).padStart(2, "0");
  const toICS = (dt: Date) => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
    `DTSTART:${toICS(d)}`, `DTEND:${toICS(end)}`,
    `SUMMARY:A&T Fence Staining — ${tier} Package`,
    `DESCRIPTION:A&T's Pressure Wash fence staining.\\nAddress: ${address}`,
    `LOCATION:${address}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return "data:text/calendar;charset=utf8," + encodeURIComponent(ics);
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ─── Trust card: Preparation ──────────────────────────────────────────────────
function TrustCardPrep({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16 }}>
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p style={{ color: C.cream, fontFamily: "'DM Sans', sans-serif" }} className="font-semibold text-sm md:text-base">
              Professional Preparation &amp; Cleaning
            </p>
            <ul className="mt-2 space-y-1.5">
              {["Removes mold, mildew & dirt buildup", "Ensures deep stain penetration", "Required for long-lasting results"].map((b) => (
                <li key={b} className="flex items-start gap-2 text-xs md:text-sm" style={{ color: C.textMuted }}>
                  <span style={{ color: C.gold }} className="shrink-0 mt-0.5">✓</span> {b}
                </li>
              ))}
            </ul>
          </div>
          <button onClick={onToggle}
            className="text-xs px-3 py-1.5 rounded-full shrink-0 transition-colors font-medium"
            style={{ background: open ? "rgba(201,168,76,0.15)" : "#C9A84C", color: open ? "#C9A84C" : "#FFFFFF", fontFamily: "'DM Sans', sans-serif" }}>
            {open ? "Got it ↑" : "See our process →"}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-5 space-y-4 border-t md:px-5" style={{ borderColor: C.border }}>
          <div className="mt-4 space-y-2">
            {[
              { icon: "🧼", title: "Biodegradable Chemical Soft Wash", desc: "We pre-treat the fence with an eco-safe solution that dissolves mold, mildew, and oxidation — without harming your plants, pets, or yard." },
              { icon: "💧", title: "Precision Pressure Wash Follow-Up (If Needed)", desc: "A targeted rinse removes all loosened debris, leaving a perfectly clean surface for maximum stain penetration and adhesion." },
            ].map((s, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(28,34,53,0.06)", border: `1px solid ${C.border}` }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base" style={{ background: C.gold, color: "#fff" }}>
                  {s.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.cream, fontFamily: "'DM Sans', sans-serif" }}>{s.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: C.textMuted, fontFamily: "'DM Sans', sans-serif" }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl p-3 md:p-4 border-l-2" style={{ background: C.cardLight, borderLeftColor: C.gold }}>
            <p className="text-xs font-semibold mb-1" style={{ color: C.gold }}>Why does this matter?</p>
            <p className="text-xs md:text-sm" style={{ color: C.textMuted, fontFamily: "'DM Sans', sans-serif" }}>
              Staining over dirt, mold, or old oxidation leads to peeling, uneven color, and a finish that fails in under a year.
              Our 2-step prep is what separates a result that lasts 5+ years from one that needs redoing in 18 months.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Trust card: Guarantee ────────────────────────────────────────────────────
function TrustCardGuarantee({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const QAS = [
    { q: "What if I don't like how it looks?", a: "We do a full walkthrough before we pack up. We don't leave until you're happy." },
    { q: "What if it rains right after?", a: "We monitor the weather and never stain before rain. If weather surprises us, we come back at no charge." },
    { q: "How long will the stain last?", a: "Essential ~2 years, Signature 3-5 years, Legacy 5-8 years, depending on sun exposure." },
    { q: "Will you protect my landscaping?", a: "We cover all plants and bushes. Our chemicals are biodegradable and pet-safe." },
    { q: "What if you miss a spot?", a: "We apply 2 full coats. Text us a photo if you spot anything and we'll come back." },
    { q: "Licensed & insured? Any surprise charges?", a: "Fully licensed and insured. Your quote covers all staining and cleaning. Board replacement is separate if needed." },
    { q: "What about my neighbor's fence?", a: "We use protective shields and careful application to keep stain off adjacent surfaces." },
  ];
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16 }}>
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p style={{ color: C.cream, fontFamily: "'DM Sans', sans-serif" }} className="font-semibold text-sm md:text-base">
              Proven Process &amp; Guarantee
            </p>
            <ul className="mt-2 space-y-1.5">
              {["All labor & materials included", "1,000+ fences restored in Houston", "7 years of fence restoration experience"].map((b) => (
                <li key={b} className="flex items-start gap-2 text-xs md:text-sm" style={{ color: C.textMuted }}>
                  <span style={{ color: C.gold }} className="shrink-0 mt-0.5">✓</span> {b}
                </li>
              ))}
            </ul>
          </div>
          <button onClick={onToggle}
            className="text-xs px-3 py-1.5 rounded-full shrink-0 transition-colors font-medium"
            style={{ background: open ? "rgba(201,168,76,0.15)" : "#C9A84C", color: open ? "#C9A84C" : "#FFFFFF", fontFamily: "'DM Sans', sans-serif" }}>
            {open ? "Got it ↑" : "Our guarantees →"}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-5 border-t md:px-5" style={{ borderColor: C.border }}>
          <div className="mt-4">
            {QAS.map(({ q, a }) => (
              <div key={q} className="flex gap-2 items-start py-2.5 border-b last:border-b-0" style={{ borderColor: C.border }}>
                <span className="text-sm shrink-0 mt-0.5">✅</span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: C.cream, fontFamily: "'DM Sans', sans-serif" }}>{q}</p>
                  <p className="text-xs md:text-sm mt-0.5" style={{ color: C.textMuted, fontFamily: "'DM Sans', sans-serif" }}>{a}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {["Licensed & Insured", "No Hidden Fees", "Satisfaction Guaranteed", "Pet & Yard Safe"].map((b) => (
              <span key={b} className="text-xs px-3 py-1 rounded-full border"
                style={{ color: "#C9A84C", borderColor: "rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.10)", fontFamily: "'DM Sans', sans-serif" }}>{b}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [pkg, setPkg] = useState<"essential" | "signature" | "legacy" | null>(null);
  const [openTrust, setOpenTrust] = useState<"prep" | "guarantee" | null>(null);
  const [colorMode, setColorMode] = useState<"gallery" | "hoa_only" | "hoa_approved" | "custom">("gallery");
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [hoaColors, setHoaColors] = useState<number[]>([]);
  const [customColor, setCustomColor] = useState("");
  const [hoaCustomBrand, setHoaCustomBrand] = useState("");
  const [hoaSendLater, setHoaSendLater] = useState(false);
  const [customSendLater, setCustomSendLater] = useState(false);

  // Step 2
  const [availableDates, setAvailableDates] = useState<ScheduleSlot[]>([]);
  const [datesMonth, setDatesMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const [datesLoading, setDatesLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [backupDates, setBackupDates] = useState<string[]>([]);
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);

  // Contact
  const [contactEmail, setContactEmail] = useState("");

  // Additional services request
  const [additionalRequest, setAdditionalRequest] = useState("");

  // Booking
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);

  const colorRef = useRef<HTMLDivElement>(null);
  const signatureScrollRef = useRef<HTMLButtonElement>(null);
  const reportedStages = useRef<Set<string>>(new Set());

  useEffect(() => {
    api.getProposal(token)
      .then((data) => {
        setProposal(data);
        if (data.status === "booked") {
          setStep(3);
          if (data.selected_tier && (data.selected_tier === "essential" || data.selected_tier === "signature" || data.selected_tier === "legacy")) {
            setPkg(data.selected_tier);
          }
          if (data.booked_at) {
            setSelectedDate(data.booked_at.slice(0, 10));
          }
          if (data.backup_dates?.length) {
            setBackupDates(data.backup_dates.slice(0, 1));
          }
          if (data.contact_email) {
            setContactEmail(data.contact_email);
          }
        } else {
          trackStage("opened");
        }
      })
      .catch((e) => setError(e.message || "Proposal not found"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    window.history.replaceState({}, "", `/proposal/${token}`);
    setProcessingPayment(true);
    api.bookProposal(token, { stripe_session_id: sessionId, selected_tier: "", booked_at: "" })
      .then((res) => {
        setProposal(prev => prev ? {
          ...prev,
          status: "booked",
          selected_tier: res.selected_tier,
          booked_at: res.booked_at,
          booked_tier_price: res.booked_tier_price,
          color_display: res.color_display,
          backup_dates: res.backup_dates,
          deposit_paid: res.deposit_paid,
          address: res.address || prev.address,
        } : prev);
        if (res.selected_tier === "essential" || res.selected_tier === "signature" || res.selected_tier === "legacy") {
          setPkg(res.selected_tier);
        }
        setSelectedDate(res.booked_at.slice(0, 10));
        setBackupDates((res.backup_dates || []).slice(0, 1));
        setStep(3);
      })
      .catch((e) => {
        setBookError(e instanceof Error ? e.message : "Payment verified but booking failed. Please call us at (832) 334-6528.");
      })
      .finally(() => setProcessingPayment(false));
  }, [token]);

  const trackStage = (stage: string) => {
    if (reportedStages.current.has(stage)) return;
    reportedStages.current.add(stage);
    api.updateProposalStage(token, stage).catch(() => {});
  };

  const loadDates = async (month: string) => {
    setDatesLoading(true);
    try { setAvailableDates(await api.getAvailableDates(month)); }
    catch { setAvailableDates([]); }
    finally { setDatesLoading(false); }
  };

  useEffect(() => { if (step === 2) loadDates(datesMonth); }, [step, datesMonth]);

  // Track color_selected stage when color selection is complete
  useEffect(() => {
    if (isColorComplete()) trackStage("color_selected");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColor, hoaColors, customColor, hoaSendLater, customSendLater, colorMode, pkg]);

  // Auto-center Signature card on mobile
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setTimeout(() => {
        signatureScrollRef.current?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
      }, 150);
    }
  }, []);

  const handleSelectPkg = (p: "essential" | "signature" | "legacy") => {
    setPkg(p);
    setSelectedColor(null);
    setHoaColors([]);
    setCustomColor("");
    if (p === "essential") {
      setColorMode("gallery");
      setSelectedColor(0);
    }
    trackStage("package_selected");
    setTimeout(() => colorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const toggleHoaColor = (id: number) => {
    setHoaColors((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id]);
  };

  const getHoaColorNames = (): string[] => {
    const names = hoaColors.map((id) => {
      const color = MAIN_COLORS.find((x) => x.id === id) || PALETTE_COLORS.find((x) => x.id === id);
      return color?.name || String(id);
    });
    if (hoaCustomBrand.trim()) names.push(hoaCustomBrand.trim());
    return names;
  };

  const isColorComplete = (): boolean => {
    if (!pkg) return false;
    if (pkg === "essential") return true;
    if (colorMode === "gallery") return selectedColor !== null && (selectedColor !== -1 || customColor.trim().length > 0);
    if (colorMode === "hoa_only") return hoaColors.length >= 2;
    if (colorMode === "hoa_approved") return hoaSendLater || customColor.trim().length > 0;
    if (colorMode === "custom") return customSendLater || customColor.trim().length > 0;
    return false;
  };

  const getColorDisplayName = (): string => {
    if (!pkg || pkg === "essential") return "Clear Sealant";
    if (colorMode === "gallery") {
      if (selectedColor === -1) return customColor.trim();
      const c = MAIN_COLORS.find((x) => x.id === selectedColor) || PALETTE_COLORS.find((x) => x.id === selectedColor);
      return c ? `${c.name} (${(c as typeof MAIN_COLORS[0] & { brand?: string }).brand || ""})`.trim().replace(/\(\)$/, "").trim() : "";
    }
    if (colorMode === "hoa_only") return `HOA: ${hoaColors.length} colors ranked`;
    if (colorMode === "hoa_approved") return hoaSendLater ? "HOA Approved (sending later)" : customColor;
    if (colorMode === "custom") return customSendLater ? "Custom (sending later)" : customColor;
    return "";
  };

  const handleCheckout = async () => {
    if (!selectedDate || !proposal || !pkg) return;
    setBooking(true); setBookError(null);
    trackStage("checkout_started");
    const bookedAt = new Date(selectedDate + "T09:00:00");
    const backupDatePayload = backupDates.map((d) => new Date(d + "T09:00:00").toISOString());
    const colorData = pkg === "essential"
      ? { selected_color: "Clear Sealant", color_mode: "gallery", hoa_colors: null, custom_color: null }
      : colorMode === "gallery"
      ? { selected_color: getColorDisplayName(), color_mode: "gallery", hoa_colors: null, custom_color: null }
      : colorMode === "hoa_only"
      ? { selected_color: null, color_mode: "hoa_only", hoa_colors: getHoaColorNames(), custom_color: null }
      : { selected_color: null, color_mode: colorMode, hoa_colors: null, custom_color: customColor || null };
    try {
      const { checkout_url } = await api.createCheckout(token, {
        selected_tier: pkg,
        booked_at: bookedAt.toISOString(),
        contact_email: contactEmail.trim() || null,
        backup_dates: backupDatePayload,
        additional_request: additionalRequest.trim() || null,
        ...colorData,
      });
      window.location.href = checkout_url;
    } catch (e: unknown) {
      setBookError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBooking(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="text-center space-y-4">
        <div className="h-10 w-10 rounded-full border-2 border-t-transparent animate-spin mx-auto"
          style={{ borderColor: C.gold, borderTopColor: "transparent" }} />
        <p style={{ color: C.textMuted, fontFamily: "'DM Sans', sans-serif" }} className="text-sm">Loading your proposal…</p>
      </div>
    </div>
  );

  if (error || !proposal) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }} className="px-4">
      <div className="text-center space-y-4 max-w-sm">
        <h1 style={{ color: C.cream, fontFamily: "'Playfair Display', serif" }} className="text-2xl font-bold">Proposal not found</h1>
        <p style={{ color: C.textMuted, fontFamily: "'DM Sans', sans-serif" }} className="text-sm">This link may have expired or is invalid. Contact us directly and we'll get you sorted.</p>
        <a href="tel:+18323346528" style={{ color: C.gold, fontFamily: "'DM Sans', sans-serif" }} className="block mt-4 text-lg font-semibold">(832) 334-6528</a>
      </div>
    </div>
  );

  const tiers = proposal.tiers;
  const bookedTierKey = ((proposal.selected_tier as "essential" | "signature" | "legacy" | undefined) || pkg);
  const tierPrice = proposal.booked_tier_price ?? (tiers && bookedTierKey ? tiers[bookedTierKey] : 0);
  const firstName = proposal.customer_name?.split(" ")[0] || "";
  const previouslyStained = (proposal.previously_stained || "No").toLowerCase().startsWith("y");
  const selectedColorDisplay = proposal.color_display || getColorDisplayName() || "Not specified";
  const selectedBackupDates = (proposal.backup_dates || backupDates || []).slice(0, 1);


  const TIERS = [
    { key: "essential" as const, label: "Essential Seal™", badge: null,
      features: ["Clear natural wood refresh", "Slows moisture & sun damage", "Most affordable option"],
      bg: C.card, accentColor: "#CBD5E1", labelColor: C.cream,
      disabled: previouslyStained, disabledMsg: "Not available for previously stained fences, the sealant won't adhere properly to prior stain." },
    { key: "signature" as const, label: "Signature Finish™", badge: "Most Popular",
      features: ["Rich, even color finish", "Protects against sun & moisture", "No restaining for years", "Chosen by 8 out of 10 homeowners"],
      bg: C.card, accentColor: C.gold, labelColor: C.cream,
      disabled: false, disabledMsg: "" },
    { key: "legacy" as const, label: "Legacy Finish™", badge: "Premium",
      features: ["Bold, uniform color", "Maximum Texas-grade sun protection", "Longest-lasting deep penetration", "Priority scheduling"],
      bg: "#F8FAFC", accentColor: C.goldLight, labelColor: C.cream,
      disabled: false, disabledMsg: "" },
  ];

  // Calendar helpers
  const [calYear, calMonthNum] = datesMonth.split("-").map(Number);
  const dateSlotMap = Object.fromEntries(availableDates.map((s) => [s.date, s]));
  const firstDayOfMonth = new Date(calYear, calMonthNum - 1, 1).getDay();
  const daysInCalMonth = new Date(calYear, calMonthNum, 0).getDate();
  const calCells: (number | null)[] = [...Array(firstDayOfMonth).fill(null), ...Array.from({ length: daysInCalMonth }, (_, i) => i + 1)];
  while (calCells.length % 7 !== 0) calCells.push(null);
  const todayISO = new Date().toISOString().slice(0, 10);

  const prevDatesMonth = () => {
    const d = new Date(calYear, calMonthNum - 2, 1);
    setDatesMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextDatesMonth = () => {
    const d = new Date(calYear, calMonthNum, 1);
    setDatesMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const headingStyle = { fontFamily: "'Cormorant Garamond', serif" };
  const bodyStyle = { fontFamily: "'DM Sans', sans-serif" };

  // ── Selected color chip (for sidebar/bar) ─────────────────────────────────
  const colorChip = () => {
    if (!pkg || pkg === "essential") return null;
    if (colorMode === "gallery" && selectedColor && selectedColor !== -1) {
      const c = MAIN_COLORS.find((x) => x.id === selectedColor) || PALETTE_COLORS.find((x) => x.id === selectedColor);
      if (c) return <span className="h-3 w-3 rounded-full inline-block shrink-0" style={{ background: (c as { hex: string }).hex }} />;
    }
    return null;
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');
        @keyframes popIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .pop-in { animation: popIn 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        .fade-slide { animation: fadeSlide 0.3s ease forwards; }
        .dark-btn:hover { opacity: 0.88; transform: translateY(-1px); }
        .dark-btn { transition: all 0.15s ease; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input:focus { box-shadow: 0 0 0 2px rgba(28,34,53,0.2); outline: none; }
      `}</style>

      {processingPayment && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,14,12,0.95)", zIndex: 50,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: `3px solid ${C.gold}`,
            borderTopColor: "transparent", animation: "spin 0.8s linear infinite", marginBottom: 20 }} />
          <p style={{ color: C.cream, fontSize: 18, fontWeight: 600 }}>Confirming your booking...</p>
          <p style={{ color: C.textMuted, fontSize: 13, marginTop: 8 }}>Please don&apos;t close this tab</p>
        </div>
      )}

      <div style={{ minHeight: "100vh", background: C.bg, ...bodyStyle }}>

        {/* ═══ HEADER ══════════════════════════════════════════════════════════ */}
        <header
          style={{ background: "#4C4C4C", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
          className="px-4 py-3 sticky top-0 z-40">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              {!logoError ? (
                <img
                  src="https://atpressurewash.com/wp-content/uploads/2025/10/footer-logo.png"
                  alt="A&T's Pressure Washing"
                  className="h-8 sm:h-10 w-auto object-contain"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <div>
                  <p style={{ color: "#FFFFFF", ...headingStyle }} className="font-bold text-lg leading-none">A&amp;T&apos;s</p>
                  <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }} className="leading-tight">Fence Restoration</p>
                </div>
              )}
              <div className="hidden sm:flex flex-col ml-1">
                <span style={{ color: "rgba(255,255,255,0.85)" }} className="text-xs font-medium leading-none">Fence Restoration Division</span>
                <span style={{ color: "rgba(255,255,255,0.5)" }} className="text-[10px] mt-0.5 leading-none">Where Trust Meets Quality</span>
              </div>
            </div>

            {/* Phone */}
            <a
              href="tel:+18323346528"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all"
              style={{ color: "#FFFFFF", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", ...bodyStyle }}>
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.35 9.87 19.79 19.79 0 01.27 1.26 2 2 0 012.24.01h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.3 7.91a16 16 0 006.06 6.06l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              <span className="text-sm font-semibold">(832) 334-6528</span>
            </a>
          </div>
        </header>

        {/* ═══ STEP INDICATOR ══════════════════════════════════════════════════ */}
        {step < 3 && (
          <div style={{ background: "#EEF0F5", borderBottom: `1px solid ${C.border}` }}
            className="px-4 py-3">
            <div className="max-w-6xl mx-auto flex items-center justify-center">
              <div className="flex items-center w-48">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex items-center" style={{ flex: s < 3 ? "1" : "none" }}>
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all"
                      style={{
                        background: s <= step ? C.gold : "#D1D5DB",
                        color: s <= step ? "#fff" : "#9CA3AF",
                        fontFamily: "'Cormorant Garamond', serif",
                      }}>
                      {s < step ? "✓" : s}
                    </div>
                    {s < 3 && (
                      <div className="h-0.5 flex-1 mx-1 transition-all"
                        style={{ background: s < step ? C.gold : "#D1D5DB" }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ MAIN LAYOUT ═════════════════════════════════════════════════════ */}
        {/* Step 3 is centered/single-col; Steps 1-2 use responsive 2-col on desktop */}
        {step === 3 ? (
          <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="text-center space-y-6">
              <div className="mx-auto h-20 w-20 rounded-full flex items-center justify-center pop-in"
                style={{ background: "rgba(76,175,80,0.15)", border: `2px solid ${C.green}` }}>
                <svg viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div>
                <h1 style={{ color: C.cream, ...headingStyle }} className="text-2xl md:text-3xl font-bold">
                  Welcome to the A&amp;T&apos;s Family{firstName ? `, ${firstName}` : ""}!
                </h1>
                <p style={{ color: C.creamDark }} className="mt-2 text-sm md:text-base">Your fence restoration is confirmed.</p>
              </div>

              {/* Summary card */}
              <div className="rounded-2xl overflow-hidden text-left" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                {[
                  { label: "Package", value: bookedTierKey ? `${TIERS.find((t) => t.key === bookedTierKey)?.label}` : "—" },
                  { label: "Price", value: fmtFull(tierPrice) },
                  { label: "Color", value: selectedColorDisplay },
                  { label: "Date", value: proposal.booked_at ? formatDateDisplay(proposal.booked_at.slice(0, 10)) : "—" },
                  { label: "Backup Date", value: selectedBackupDates.length ? selectedBackupDates.map((d) => formatShortDateDisplay(d)).join(", ") : "None selected" },
                  { label: "Crew Arrival", value: "8:00 – 9:00 AM" },
                  ...(proposal.fence_sides ? [{ label: "Sections", value: proposal.fence_sides }] : []),
                  { label: "Deposit Paid", value: "$50.00 (applied to balance)" },
                  { label: "Remaining Balance", value: `${fmtFull(tierPrice - 50)} (due day of service)` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-start px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ color: C.textMuted }} className="text-sm shrink-0">{label}</span>
                    <span style={{ color: C.cream }} className="text-sm font-semibold text-right ml-4 max-w-[60%]">{value}</span>
                  </div>
                ))}
              </div>

              {(proposal.color_mode === "hoa_only" || proposal.color_mode === "hoa_approved") && (
                <div className="rounded-xl p-4 text-left" style={{ background: "rgba(28,34,53,0.05)", border: `1px solid ${C.border}` }}>
                  <p style={{ color: C.gold }} className="text-sm font-semibold">HOA Approval Support</p>
                  <p style={{ color: C.textMuted }} className="text-xs mt-1 leading-relaxed">
                    {proposal.color_mode === "hoa_only"
                      ? "We've texted you your color options and fence specs. We'll also prepare a ready-to-forward HOA letter — just let us know your board's contact."
                      : "Your HOA approval is confirmed. We've texted you the full stain product details for your records."}
                  </p>
                </div>
              )}

              <div className="rounded-xl p-3 text-left" style={{ background: "rgba(28,34,53,0.05)", borderLeft: `3px solid ${C.gold}` }}>
                <p style={{ color: C.textMuted }} className="text-xs">Dates may shift due to weather at no charge. We&apos;ll always notify you in advance.</p>
              </div>

              <div className="text-left space-y-3">
                <p style={{ color: C.cream }} className="font-semibold text-sm">What happens next:</p>
                {[
                  "We've sent you a text message with your booking details and arrival time",
                  "We'll reach out before your date to confirm — expect the crew between 8:00–9:00 AM",
                  "Your crew will arrive with your chosen color and prep system ready to go",
                  "After the job, we'd love a quick Google review!",
                ].map((text, i) => (
                  <div key={text} className="flex items-start gap-3">
                    <span className="text-xs font-bold shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: C.gold, color: "#FFFFFF", marginTop: 2 }}>{i + 1}</span>
                    <p style={{ color: C.creamDark }} className="text-sm">{text}</p>
                  </div>
                ))}
              </div>

              {proposal.booked_at && bookedTierKey && (
                <a
                  href={generateICS(proposal.customer_name || "", proposal.address || "", proposal.booked_at.slice(0, 10), TIERS.find((t) => t.key === bookedTierKey)?.label || "Fence Staining")}
                  download="at-fence-staining.ics"
                  className="block w-full rounded-2xl py-3.5 text-center font-semibold text-sm dark-btn"
                  style={{ background: "rgba(28,34,53,0.07)", color: C.gold, border: `1px solid ${C.border}`, ...bodyStyle }}>
                  Add to Calendar
                </a>
              )}

              <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <p style={{ color: C.cream }} className="font-semibold text-sm mb-2">Questions? We&apos;re here.</p>
                <a href="tel:+18323346528" style={{ color: C.gold }} className="font-semibold block text-lg">(832) 334-6528</a>
                <p style={{ color: C.textMuted }} className="text-xs mt-1">Or reply to any of our texts, we respond fast.</p>
              </div>

              <p style={{ color: C.textMuted }} className="text-xs pb-4">
                A&amp;T&apos;s Pressure Washing · Houston, TX · Serving Cypress, The Woodlands, Katy &amp; surrounding areas
              </p>
            </div>
          </div>
        ) : (
          /* Steps 1 & 2: responsive 2-col on desktop */
          <div className="max-w-6xl mx-auto px-4 pt-6 pb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_300px] lg:gap-10 xl:gap-12 lg:items-start">

            {/* ── MAIN CONTENT COLUMN ─────────────────────────────────────── */}
            <div className="min-w-0 space-y-5">

              {/* ── STEP 1 ── */}
              {step === 1 && (
                <>
                  {/* Greeting */}
                  <div>
                    <h1 style={{ color: C.cream, ...headingStyle }} className="text-2xl md:text-3xl font-bold leading-tight">
                      {firstName ? `Hi ${firstName}, here's your custom proposal!` : "Your Custom Proposal"}
                    </h1>
                    {proposal.address && (
                      <p style={{ color: C.textMuted }} className="text-sm mt-1.5 flex items-center gap-1.5">
                        <span>{proposal.address}</span>
                      </p>
                    )}
                  </div>

                  {/* Section header + Trust cards + Promo — above packages */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: C.gold, color: "#FFFFFF" }}>1</span>
                        <h2 style={{ color: C.cream, ...headingStyle }} className="text-xl font-semibold">What Every Job Includes</h2>
                      </div>
                      <p style={{ color: C.textMuted }} className="text-sm mt-1 pl-8">Before you choose, we want you to know exactly how we show up for you, every step of the way.</p>
                    </div>

                    <TrustCardPrep open={openTrust === "prep"} onToggle={() => setOpenTrust(openTrust === "prep" ? null : "prep")} />
                    <TrustCardGuarantee open={openTrust === "guarantee"} onToggle={() => setOpenTrust(openTrust === "guarantee" ? null : "guarantee")} />

                    {/* Promo banner */}
                    <div className="rounded-2xl p-4 md:p-5"
                      style={{ background: C.card, border: `1px solid ${C.border}` }}>
                      <div>
                        <p style={{ color: "#C9A84C", ...headingStyle }} className="font-bold text-xl md:text-2xl">20% OFF Standard Rates</p>
                        <p style={{ color: C.creamDark }} className="text-sm mt-1">All options include our professional deep cleaning prep.</p>
                        <p style={{ color: C.textMuted }} className="text-xs mt-1.5">
                          Offer expires {getPromoDeadline()} · Lock in your date to keep this discount
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ── HOA Requirements section ── */}
                  <div>
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: C.gold, color: "#FFFFFF" }}>2</span>
                      <h2 style={{ color: C.cream, ...headingStyle }} className="text-lg font-semibold">Do You Have HOA Color Requirements?</h2>
                    </div>
                    <p style={{ color: C.textMuted }} className="text-sm mt-1 pl-8 mb-3">Let us know now so we can prepare the right documentation for your board.</p>

                    <div className="grid gap-2 pl-0">
                      {[
                        { mode: "gallery" as const, label: "No HOA, I'll pick from the color gallery", desc: "Standard gallery selection, no board approval needed" },
                        { mode: "hoa_only" as const, label: "I need HOA approval first", desc: "We'll help you submit 2–5 ranked color choices to your board" },
                        { mode: "hoa_approved" as const, label: "I already have my HOA-approved color", desc: "Enter the pre-approved color name at the next step" },
                      ].map(({ mode, label, desc }) => {
                        const isActive = colorMode === mode;
                        return (
                          <button key={mode}
                            onClick={() => { setColorMode(mode); trackStage("hoa_selected"); }}
                            className="w-full text-left rounded-xl p-3 border-2 transition-all"
                            style={{
                              background: isActive ? "rgba(28,34,53,0.06)" : C.cardLight,
                              borderColor: isActive ? C.gold : C.border,
                            }}>
                            <div className="flex items-start gap-2">
                              <div className="shrink-0 mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center" style={{ borderColor: isActive ? C.gold : C.textMuted }}>
                                {isActive && <div className="h-2 w-2 rounded-full" style={{ background: C.gold }} />}
                              </div>
                              <div>
                                <p style={{ color: C.cream }} className="text-sm font-semibold">{label}</p>
                                <p style={{ color: C.textMuted }} className="text-xs mt-0.5">{desc}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {(colorMode === "hoa_only" || colorMode === "hoa_approved") && (
                      <div className="mt-3 rounded-xl p-4 fade-slide" style={{ background: "rgba(212,166,74,0.07)", border: "1px solid rgba(212,166,74,0.35)" }}>
                        <p style={{ color: "#92701A" }} className="text-sm font-semibold mb-1">About HOA Color Approval</p>
                        <p style={{ color: C.textMuted }} className="text-xs leading-relaxed">
                          HOA boards typically take <strong style={{ color: C.creamDark }}>2–6 weeks</strong> to review color requests, but we make the process easy. Once you book, we&apos;ll send you a ready-to-forward submission packet that includes product spec sheets, color swatches, and a pre-written approval letter drafted specifically for your HOA board. Most of our customers get first-try approval.
                        </p>
                        {colorMode === "hoa_only" && (
                          <p style={{ color: C.textMuted }} className="text-xs mt-2 leading-relaxed">
                            <strong style={{ color: C.creamDark }}>Next:</strong> After picking your package, you&apos;ll rank 2–5 color options from our gallery. We&apos;ll submit your top choices to give your HOA the best selection to approve from.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Package cards — horizontal swipe on mobile, 3-col on sm+ ── */}
                  <div>
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: C.gold, color: "#FFFFFF" }}>3</span>
                      <h2 style={{ color: C.cream, ...headingStyle }} className="text-lg font-semibold">Choose Your Package</h2>
                    </div>
                    <div
                      className="flex gap-4 overflow-x-auto py-3 -mx-4 px-4 md:grid md:grid-cols-3 md:overflow-visible md:mx-0 md:px-0 md:py-4 md:gap-8 lg:gap-10"
                      style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
                      {TIERS.map(({ key, label, badge, features, bg, accentColor, labelColor, disabled, disabledMsg }) => {
                        const price = tiers ? tiers[key] : 0;
                        const isSelected = pkg === key;
                        const REAL_GOLD = "#C9A84C";
                        const borderThickness = key === "signature" ? "2.5px" : key === "legacy" ? "2px" : "1px";
                        const unselectedBorder = disabled
                          ? "rgba(229,57,53,0.3)"
                          : key === "signature"
                          ? REAL_GOLD
                          : key === "legacy"
                          ? C.gold
                          : "#D1D5DB";
                        const cardShadow = isSelected
                          ? `0 6px 28px rgba(28,34,53,0.18)`
                          : key === "signature"
                          ? `0 4px 28px rgba(201,168,76,0.50), 0 1px 8px rgba(201,168,76,0.30)`
                          : key === "legacy"
                          ? `0 4px 20px rgba(28,34,53,0.13), 0 1px 4px rgba(28,34,53,0.06)`
                          : `0 1px 4px rgba(0,0,0,0.04)`;
                        const accentBarHeight = key === "legacy" ? 7 : key === "signature" ? 6 : 3;
                        const accentBarBg = key === "signature"
                          ? `linear-gradient(90deg, ${REAL_GOLD}, #E8C76A, ${REAL_GOLD})`
                          : key === "legacy" || isSelected ? C.gold : accentColor;
                        const cardBg = key === "legacy" ? "#FDFCF9" : bg;
                        return (
                          <button
                            key={key}
                            ref={key === "signature" ? signatureScrollRef : undefined}
                            onClick={() => !disabled && handleSelectPkg(key)}
                            disabled={disabled}
                            className="text-left rounded-2xl transition-all overflow-hidden shrink-0 snap-center md:shrink md:w-auto"
                            style={{
                              width: "76vw",
                              maxWidth: 290,
                              background: cardBg,
                              border: `${borderThickness} solid ${isSelected ? (key === "signature" ? REAL_GOLD : C.gold) : unselectedBorder}`,
                              opacity: disabled ? 0.55 : 1,
                              cursor: disabled ? "not-allowed" : "pointer",
                              padding: 0,
                              boxShadow: cardShadow,
                            }}>
                            {/* Accent bar */}
                            <div style={{ height: accentBarHeight, background: accentBarBg }} />
                            <div className="p-4">
                              {/* Badges row */}
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {badge && (
                                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                                      style={{
                                        background: key === "signature" ? REAL_GOLD : C.gold,
                                        color: "#FFFFFF",
                                        letterSpacing: "0.02em",
                                      }}>
                                      {key === "legacy" ? `★ ${badge}` : badge}
                                    </span>
                                  )}
                                  {disabled && (
                                    <span className="text-xs px-2 py-0.5 rounded-full"
                                      style={{ background: "rgba(229,57,53,0.2)", color: C.red }}>Unavailable</span>
                                  )}
                                </div>
                                {isSelected && (
                                  <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0"
                                    style={{ background: key === "signature" ? REAL_GOLD : C.gold }}>
                                    <span className="text-xs font-bold" style={{ color: "#FFFFFF" }}>✓</span>
                                  </div>
                                )}
                              </div>

                              {/* Title */}
                              <p style={{ color: labelColor, ...headingStyle }} className="font-bold text-lg leading-tight">{label}</p>

                              {/* Features */}
                              <ul className="mt-2.5 space-y-1.5">
                                {features.map((f) => (
                                  <li key={f} className="flex items-start gap-2 text-xs" style={{ color: C.creamDark }}>
                                    <span style={{ color: C.gold }} className="shrink-0 mt-0.5">✓</span> {f}
                                  </li>
                                ))}
                              </ul>

                              {disabled && disabledMsg && <p className="text-xs mt-2 leading-relaxed" style={{ color: C.red }}>{disabledMsg}</p>}

                              {/* Price */}
                              {price > 0 && !disabled && (
                                <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                                  <p className="text-xs line-through" style={{ color: C.textMuted }}>{strikethrough(price)}</p>
                                  <p style={{ color: C.gold, ...headingStyle }} className="text-2xl font-bold leading-none mt-0.5">{fmt(price)}</p>
                                  <p className="text-xs mt-1" style={{ color: C.textMuted }}>{fmtMonthly(price)} · 21-mo plan</p>
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Color section ── */}
                  {pkg && (
                    <div ref={colorRef} className="space-y-4 fade-slide">
                      <div>
                        <div className="flex items-center gap-2.5 mb-1">
                          <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: C.gold, color: "#FFFFFF" }}>4</span>
                          <h2 style={{ color: C.cream, ...headingStyle }} className="text-xl font-semibold">Now, Let&apos;s Choose Your Stain Color</h2>
                        </div>
                        <p style={{ color: C.textMuted }} className="text-sm mt-1 pl-8">
                          {pkg === "essential"
                            ? "Essential Seal is a clear sealant, it preserves your fence's natural wood color."
                            : "Select the color that best fits your home and neighborhood."}
                        </p>
                      </div>

                      {pkg === "essential" ? (
                        <div className="rounded-2xl p-4 border-2" style={{ background: C.card, borderColor: C.gold }}>
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-xl border-2 shrink-0"
                              style={{ background: "linear-gradient(135deg,#C4A06A,#8B6040)", borderColor: C.gold }} />
                            <div className="flex-1">
                              <p style={{ color: C.cream }} className="font-semibold">Clear Sealant</p>
                              <p style={{ color: C.textMuted }} className="text-sm">Preserves your fence&apos;s natural wood color</p>
                            </div>
                            <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0" style={{ background: C.gold }}>
                              <span className="text-xs font-bold" style={{ color: "#FFFFFF" }}>✓</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {colorMode === "gallery" && (
                            <div className="space-y-5">
                              {/* Featured 6 — no HOA shows only main colors */}
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: C.textMuted }}>Most Popular</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                  {MAIN_COLORS.map((c) => {
                                    const isSelected = selectedColor === c.id;
                                    return (
                                      <button
                                        key={c.id}
                                        onClick={() => setSelectedColor(c.id)}
                                        className="rounded-xl overflow-hidden border-2 text-left transition-all"
                                        style={{
                                          borderColor: isSelected ? C.gold : C.border,
                                          background: C.card,
                                          boxShadow: isSelected ? `0 4px 16px rgba(28,34,53,0.10)` : "0 1px 3px rgba(0,0,0,0.05)",
                                        }}>
                                        <div style={{ height: 80, background: c.hex }} />
                                        <div className="px-3 py-2 flex items-center justify-between gap-2">
                                          <div className="min-w-0">
                                            <p style={{ color: C.cream }} className="text-xs font-semibold truncate">{c.name}</p>
                                            <p style={{ color: C.textMuted }} className="text-xs">{c.brand}</p>
                                          </div>
                                          {isSelected && (
                                            <span className="h-5 w-5 rounded-full flex items-center justify-center shrink-0" style={{ background: C.gold }}>
                                              <span style={{ color: "#FFFFFF" }} className="text-xs font-bold">✓</span>
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Other / custom */}
                              <div>
                                <button
                                  onClick={() => setSelectedColor(-1)}
                                  className="w-full text-left rounded-xl p-3.5 border-2 transition-all"
                                  style={{
                                    borderColor: selectedColor === -1 ? C.gold : C.border,
                                    background: selectedColor === -1 ? "rgba(28,34,53,0.04)" : C.cardLight,
                                  }}>
                                  <div className="flex items-center gap-3">
                                    <div className="shrink-0 h-4 w-4 rounded-full border-2 flex items-center justify-center"
                                      style={{ borderColor: selectedColor === -1 ? C.gold : C.textMuted }}>
                                      {selectedColor === -1 && <div className="h-2 w-2 rounded-full" style={{ background: C.gold }} />}
                                    </div>
                                    <div>
                                      <p style={{ color: C.cream }} className="text-sm font-semibold">Other / Custom Color</p>
                                      <p style={{ color: C.textMuted }} className="text-xs mt-0.5">Describe the color or enter a brand + color name</p>
                                    </div>
                                  </div>
                                </button>
                                {selectedColor === -1 && (
                                  <div className="mt-2 fade-slide">
                                    <input
                                      type="text"
                                      placeholder='e.g. "Sherwin-Williams Rustic Brown" or "dark brown, similar to my shutters"'
                                      value={customColor}
                                      onChange={(e) => setCustomColor(e.target.value)}
                                      className="w-full rounded-xl px-4 py-3 text-sm border outline-none"
                                      style={{ background: C.cardLight, color: C.cream, borderColor: customColor.trim() ? C.gold : C.border }}
                                      autoFocus
                                    />
                                    <p style={{ color: C.textMuted }} className="text-xs mt-1.5 pl-1">Include the brand and color name if you know it, or just describe what you&apos;re looking for.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {colorMode === "hoa_only" && (
                            <div className="space-y-4 fade-slide">
                              <div className="rounded-xl p-3" style={{ background: C.cardLight, borderLeft: `3px solid ${C.gold}` }}>
                                <p style={{ color: C.cream }} className="text-sm font-semibold">Pick 2–5 colors (ranked by preference)</p>
                                <p style={{ color: C.textMuted }} className="text-xs mt-1">We&apos;ll submit your top choices to your HOA for the best chance of first-try approval.</p>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {MAIN_COLORS.map((c) => {
                                  const rank = hoaColors.indexOf(c.id) + 1;
                                  return (
                                    <button key={c.id} onClick={() => toggleHoaColor(c.id)}
                                      className="rounded-xl overflow-hidden border-2 text-left transition-all relative"
                                      style={{ borderColor: rank > 0 ? C.gold : C.border, background: C.card }}>
                                      {rank > 0 && (
                                        <div className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center z-10"
                                          style={{ background: C.gold }}>
                                          <span className="text-xs font-bold" style={{ color: "#FFFFFF" }}>{rank}</span>
                                        </div>
                                      )}
                                      <div style={{ height: 64, background: c.hex }} />
                                      <div className="px-2 py-1.5">
                                        <p style={{ color: C.cream }} className="text-xs font-semibold">{c.name}</p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                              {hoaColors.length > 0 && (
                                <div className="rounded-xl p-3 space-y-1.5" style={{ background: C.cardLight }}>
                                  <p style={{ color: C.textMuted }} className="text-xs font-semibold mb-2">Your ranked selections:</p>
                                  {hoaColors.map((id, i) => {
                                    const c = MAIN_COLORS.find((x) => x.id === id) || PALETTE_COLORS.find((x) => x.id === id);
                                    return (
                                      <div key={id} className="flex items-center justify-between">
                                        <span style={{ color: C.creamDark }} className="text-xs">{i + 1}. {c?.name}</span>
                                        <button onClick={() => toggleHoaColor(id)} style={{ color: C.textMuted }} className="text-xs hover:text-red-400 transition-colors">Remove</button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {hoaColors.length < 2 && (
                                <p style={{ color: C.textMuted }} className="text-xs text-center">Select at least 2 colors to continue</p>
                              )}
                              {/* Optional brand/color text input for HOA */}
                              <div className="rounded-xl p-3 space-y-2" style={{ background: C.cardLight, border: `1px solid ${C.border}` }}>
                                <p style={{ color: C.cream }} className="text-xs font-semibold">Have a specific brand/color in mind? (Optional)</p>
                                <input
                                  type="text"
                                  placeholder="e.g. &quot;Ready Seal Dark Walnut&quot; — we'll include it in your HOA submission"
                                  value={hoaCustomBrand}
                                  onChange={(e) => setHoaCustomBrand(e.target.value)}
                                  className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                                  style={{ background: C.card, color: C.cream, borderColor: hoaCustomBrand.trim() ? C.gold : C.border, ...bodyStyle }}
                                />
                                <p style={{ color: C.textMuted }} className="text-xs">We&apos;ll add it as a ranked option alongside your gallery selections.</p>
                              </div>
                              <p style={{ color: C.textMuted }} className="text-xs font-semibold uppercase tracking-wider">Additional Colors, Backup options</p>
                              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                                {PALETTE_COLORS.map((c) => {
                                  const rank = hoaColors.indexOf(c.id) + 1;
                                  return (
                                    <button key={c.id} onClick={() => toggleHoaColor(c.id)}
                                      className="rounded-lg overflow-hidden border-2 transition-all relative"
                                      style={{ borderColor: rank > 0 ? C.gold : C.border }}>
                                      {rank > 0 && (
                                        <div className="absolute top-1 right-1 h-4 w-4 rounded-full flex items-center justify-center z-10"
                                          style={{ background: C.gold }}>
                                          <span className="text-[10px] font-bold" style={{ color: "#FFFFFF" }}>{rank}</span>
                                        </div>
                                      )}
                                      <div style={{ height: 40, background: c.hex }} />
                                      <div className="px-1 py-1">
                                        <p style={{ color: C.textMuted }} className="text-[10px] leading-tight truncate">{c.name}</p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {colorMode === "hoa_approved" && (
                            <div className="space-y-3 fade-slide">
                              <div className="rounded-xl p-4" style={{ background: "rgba(76,175,80,0.08)", border: "1px solid rgba(76,175,80,0.25)" }}>
                                <p style={{ color: C.green }} className="font-semibold text-sm">HOA-Approved Color</p>
                                <p style={{ color: C.textMuted }} className="text-xs mt-1">Enter your HOA-approved color (brand + name), or check the box if you&apos;ll send it later.</p>
                              </div>
                              {!hoaSendLater && (
                                <input
                                  type="text"
                                  placeholder="e.g. Ready Seal Dark Walnut"
                                  value={customColor}
                                  onChange={(e) => setCustomColor(e.target.value)}
                                  className="w-full rounded-xl px-4 py-3 text-sm border outline-none"
                                  style={{ background: C.cardLight, color: C.cream, borderColor: C.border, ...bodyStyle }} />
                              )}
                              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.textMuted }}>
                                <input type="checkbox" checked={hoaSendLater} onChange={(e) => setHoaSendLater(e.target.checked)} className="h-4 w-4 rounded" />
                                I don&apos;t know the exact name, I&apos;ll send it before my appointment
                              </label>
                            </div>
                          )}

                          {colorMode === "custom" && (
                            <div className="space-y-3 fade-slide">
                              <div className="rounded-xl p-4" style={{ background: "rgba(28,34,53,0.05)", border: `1px solid ${C.border}` }}>
                                <p style={{ color: C.gold }} className="font-semibold text-sm">Custom Color</p>
                                <p style={{ color: C.textMuted }} className="text-xs mt-1">Describe your desired color or enter a brand + name.</p>
                              </div>
                              {!customSendLater && (
                                <input
                                  type="text"
                                  placeholder="e.g. Dark brown, similar to my shutters"
                                  value={customColor}
                                  onChange={(e) => setCustomColor(e.target.value)}
                                  className="w-full rounded-xl px-4 py-3 text-sm border outline-none"
                                  style={{ background: C.cardLight, color: C.cream, borderColor: C.border, ...bodyStyle }} />
                              )}
                              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.textMuted }}>
                                <input type="checkbox" checked={customSendLater} onChange={(e) => setCustomSendLater(e.target.checked)} className="h-4 w-4 rounded" />
                                I&apos;ll send you the color before my appointment
                              </label>
                            </div>
                          )}

                          {colorMode !== "gallery" && (
                            <button onClick={() => { setColorMode("gallery"); setHoaColors([]); setCustomColor(""); }}
                              style={{ color: C.textMuted }} className="text-xs underline">
                              ← Back to standard color gallery
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Social proof */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
                    <p className="text-center text-xs" style={{ color: C.textMuted }}>
                      Join 1,000+ Houston homeowners who trust A&amp;T&apos;s for fence restoration
                    </p>
                    {proposal.fence_sides && (
                      <p className="text-center text-xs" style={{ color: C.textMuted }}>
                        Sections included: {proposal.fence_sides}
                      </p>
                    )}
                  </div>

                  {/* Spacer above sticky bar on mobile */}
                  <div className="h-28 lg:h-4" />
                </>
              )}

              {/* ── STEP 2 ── */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h1 style={{ color: C.cream, ...headingStyle }} className="text-2xl md:text-3xl font-bold">Choose Your Date</h1>
                    <p style={{ color: C.textMuted }} className="text-sm mt-1">
                      {colorMode === "hoa_only"
                        ? "Pick your preferred date. We'll prompt you to add a backup since HOA approval can take time."
                        : "Choose your preferred service date. We'll confirm availability and reach out before your appointment."}
                    </p>
                  </div>

                  {/* Date guidance */}
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs px-3 py-1.5 rounded-full font-medium"
                      style={{ background: "rgba(28,34,53,0.07)", color: C.gold, border: `1px solid ${C.border}` }}>
                      {colorMode === "hoa_only" ? "1st tap = preferred · 2nd tap = backup" : "Tap a date to select"}
                    </span>
                    <span className="text-xs px-3 py-1.5 rounded-full font-medium"
                      style={{ background: "rgba(22,163,74,0.10)", color: C.green, border: "1px solid rgba(22,163,74,0.25)" }}>
                      Green dates = best availability
                    </span>
                  </div>

                  {/* Calendar */}
                  <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
                      <button onClick={prevDatesMonth} className="p-1 text-xl font-light w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-black/5" style={{ color: C.textMuted }}>‹</button>
                      <p style={{ color: C.cream, ...headingStyle }} className="font-semibold">{MONTH_NAMES[calMonthNum - 1]} {calYear}</p>
                      <button onClick={nextDatesMonth} className="p-1 text-xl font-light w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-black/5" style={{ color: C.textMuted }}>›</button>
                    </div>
                    <div className="px-3 py-3 md:px-4 md:py-4">
                      <div className="grid grid-cols-7 mb-2">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <div key={d} className="text-center text-xs font-medium py-1" style={{ color: C.textMuted }}>{d}</div>
                        ))}
                      </div>
                      {datesLoading ? (
                        <div className="flex items-center justify-center h-36">
                          <div className="h-7 w-7 rounded-full border-2 border-t-transparent animate-spin"
                            style={{ borderColor: C.gold, borderTopColor: "transparent" }} />
                        </div>
                      ) : (
                        <div className="grid grid-cols-7 gap-1">
                          {calCells.map((day, i) => {
                            if (!day) return <div key={i} />;
                            const dateStr = `${calYear}-${String(calMonthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                            const slot = dateSlotMap[dateStr];
                            const isPast = dateStr < todayISO;
                            const isPreferred = Boolean(slot);
                            const isPrimary = selectedDate === dateStr;
                            const isBackup = backupDates.includes(dateStr);
                            if (isPast) return (
                              <div key={i} className="rounded-lg text-center py-2.5">
                                <p className="text-xs" style={{ color: "#9CA3AF", opacity: 0.4 }}>{day}</p>
                              </div>
                            );
                            const backupIndex = backupDates.indexOf(dateStr);
                            const selectionLabel = isPrimary ? "1st" : backupIndex === 0 ? "2nd" : null;
                            const atMax = !isPrimary && !isBackup && selectedDate !== null && colorMode === "hoa_only" && backupDates.length >= 1;
                            return (
                              <button
                                key={i}
                                onClick={() => {
                                  if (isPrimary) {
                                    setSelectedDate(null);
                                    setBackupDates([]);
                                    setShowBackupPrompt(false);
                                    return;
                                  }
                                  if (isBackup) {
                                    setBackupDates(prev => prev.filter(d => d !== dateStr));
                                    return;
                                  }
                                  if (!selectedDate) {
                                    setSelectedDate(dateStr);
                                    trackStage("date_selected");
                                    if (colorMode === "hoa_only") {
                                      setShowBackupPrompt(true);
                                      setTimeout(() => setShowBackupPrompt(false), 6000);
                                    }
                                    return;
                                  }
                                  if (colorMode === "hoa_only" && backupDates.length < 1) {
                                    setBackupDates(prev => [...prev, dateStr]);
                                  }
                                }}
                                className="rounded-lg text-center py-2 transition-all"
                                style={{
                                  background: isPrimary ? C.gold : isBackup ? "rgba(212,166,74,0.12)" : isPreferred ? "rgba(22,163,74,0.08)" : "rgba(28,34,53,0.05)",
                                  border: `1px solid ${isPrimary ? C.gold : isBackup ? "rgba(212,166,74,0.5)" : isPreferred ? C.green : C.border}`,
                                  boxShadow: isPrimary ? `0 2px 10px rgba(212,166,74,0.3)` : "none",
                                  opacity: atMax ? 0.4 : 1,
                                  cursor: atMax ? "not-allowed" : "pointer",
                                }}>
                                <p className="text-xs font-bold leading-none" style={{ color: isPrimary ? "#FFFFFF" : C.cream }}>{day}</p>
                                {selectionLabel && (
                                  <p className="text-[8px] leading-none mt-0.5 font-bold" style={{ color: isPrimary ? "rgba(255,255,255,0.9)" : C.gold }}>{selectionLabel}</p>
                                )}
                                {!selectionLabel && isPreferred && (
                                  <p className="text-[8px] leading-none mt-0.5 font-semibold" style={{ color: C.green }}>
                                    {slot?.label || "Best Availability"}
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {availableDates.length === 0 && !datesLoading && (
                        <p className="text-center text-sm py-6" style={{ color: C.textMuted }}>No preferred dates this month, any date above is still available to request →</p>
                      )}
                    </div>
                  </div>

                  {/* Selected date confirmation */}
                  {selectedDate ? (
                    <div className="rounded-xl p-4 fade-slide" style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.25)" }}>
                      <p style={{ color: C.green }} className="font-semibold text-sm">✓ Preferred: {formatDateDisplay(selectedDate)}</p>
                      {colorMode === "hoa_only" && backupDates.length > 0 && (
                        <p style={{ color: C.creamDark }} className="text-xs mt-1">
                          Backups: {backupDates.map((d, i) => `${["2nd","3rd","4th"][i]}, ${formatShortDateDisplay(d)}`).join(" • ")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl p-3 fade-slide" style={{ background: "rgba(28,34,53,0.04)", border: `1px solid ${C.border}` }}>
                      <p style={{ color: C.textMuted }} className="text-xs">Tap a date to select your preferred day.</p>
                    </div>
                  )}

                  {/* HOA backup date prompt */}
                  {showBackupPrompt && colorMode === "hoa_only" && (
                    <div className="rounded-xl p-3 flex gap-2 items-start fade-slide" style={{ background: "rgba(201,168,76,0.12)", border: "1px solid #C9A84C" }}>
                      <span className="text-base shrink-0">📋</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold" style={{ color: C.cream }}>Pick a backup date</p>
                        <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Since you need HOA approval, we&apos;d love a second date in case processing takes extra time.</p>
                      </div>
                      <button onClick={() => setShowBackupPrompt(false)} className="text-base shrink-0" style={{ color: C.textMuted }}>✕</button>
                    </div>
                  )}

                  {/* Weather notice + arrival time */}
                  <div className="rounded-xl p-3" style={{ background: "rgba(28,34,53,0.04)", borderLeft: `3px solid ${C.gold}` }}>
                    <p style={{ color: C.gold }} className="text-xs font-semibold">Crew Arrival &amp; Weather</p>
                    <p style={{ color: C.textMuted }} className="text-xs mt-1 leading-relaxed">
                      Our crew arrives between <strong style={{ color: C.creamDark }}>8:00 – 9:00 AM</strong>. We&apos;ll send a reminder the night before.
                    </p>
                    <p style={{ color: C.textMuted }} className="text-xs mt-1 leading-relaxed">
                      Dates may shift due to weather at no charge — we always notify you in advance.
                    </p>
                  </div>

                  {/* Additional services */}
                  <div className="rounded-xl p-4" style={{ background: "rgba(28,34,53,0.04)", border: `1px solid ${C.border}` }}>
                    <p className="font-semibold text-sm" style={{ color: C.cream }}>Want a quote for additional services?</p>
                    <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                      Pressure washing, deck staining, and other add-ons are quoted separately.
                      We&apos;ll send you a separate estimate after your fence booking is confirmed.
                    </p>
                    <textarea
                      placeholder="Optional: Describe any additional services you'd like quoted…"
                      value={additionalRequest}
                      onChange={(e) => setAdditionalRequest(e.target.value)}
                      rows={2}
                      className="w-full mt-2 rounded-xl px-3 py-2.5 text-sm border outline-none resize-none"
                      style={{ background: C.cardLight, color: C.cream, borderColor: C.border, ...bodyStyle }}
                    />
                  </div>

                  {bookError && (
                    <p className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(229,57,53,0.1)", color: C.red, border: "1px solid rgba(229,57,53,0.3)" }}>{bookError}</p>
                  )}

                  {/* Book button — mobile/tablet only; desktop uses sidebar */}
                  <button
                    onClick={handleCheckout}
                    disabled={!selectedDate || booking}
                    className="w-full rounded-2xl py-4 font-semibold text-base transition-all border-none lg:hidden dark-btn"
                    style={{
                      background: selectedDate && !booking ? C.gold : "#E5E7EB",
                      color: selectedDate && !booking ? "#FFFFFF" : C.textMuted,
                      cursor: selectedDate && !booking ? "pointer" : "not-allowed",
                      ...bodyStyle,
                    }}>
                    {booking ? "Redirecting to payment…" : !selectedDate ? "Select a date first" : "Pay $50 Deposit & Book Date →"}
                  </button>
                  {/* Deposit note */}
                  <p className="text-xs text-center" style={{ color: C.textMuted }}>
                    $50 deposit is applied toward your total balance — only the remaining amount is due day of service.
                  </p>

                  <button onClick={() => { setStep(1); setShowBackupPrompt(false); window.scrollTo({ top: 0, behavior: "instant" }); }} style={{ color: C.textMuted }} className="text-sm underline w-full text-center block">
                    ← Back to package selection
                  </button>

                  <div className="h-4" />
                </div>
              )}
            </div>

            {/* ── DESKTOP SIDEBAR ─────────────────────────────────────────── */}
            <div className="hidden lg:block">
              <div className="sticky top-[73px] space-y-4">

                {/* Selection summary card */}
                <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                  <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, background: C.cardLight }}>
                    <p className="font-semibold text-sm" style={{ color: C.cream, ...headingStyle }}>Your Selection</p>
                  </div>

                  <div className="p-5 space-y-4">
                    {pkg ? (
                      <>
                        {/* Package */}
                        <div>
                          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Package</p>
                          <p className="font-semibold" style={{ color: C.cream }}>{TIERS.find(t => t.key === pkg)?.label}</p>
                        </div>

                        {/* Price */}
                        {tiers && (
                          <div>
                            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Price</p>
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs line-through" style={{ color: C.textMuted }}>{strikethrough(tiers[pkg])}</span>
                              <span className="font-bold text-2xl" style={{ color: C.gold, ...headingStyle }}>{fmt(tiers[pkg])}</span>
                            </div>
                            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>{fmtMonthly(tiers[pkg])} · 21-month plan</p>
                          </div>
                        )}

                        {/* Color */}
                        {isColorComplete() && (
                          <div>
                            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Color</p>
                            <div className="flex items-center gap-2">
                              {colorChip()}
                              <p className="text-sm font-medium" style={{ color: C.creamDark }}>{getColorDisplayName()}</p>
                            </div>
                          </div>
                        )}

                        {/* Date (step 2) */}
                        {step === 2 && selectedDate && (
                          <div>
                            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Date</p>
                            <p className="text-sm font-medium" style={{ color: C.creamDark }}>{formatDateDisplay(selectedDate)}</p>
                            {backupDates.length > 0 && (
                              <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                                Backups: {backupDates.map((d) => formatShortDateDisplay(d)).join(" • ")}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Discount badge */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                          style={{ background: "rgba(28,34,53,0.06)", border: `1px solid ${C.border}` }}>
                          <p className="text-xs font-medium" style={{ color: C.gold }}>20% discount locked in</p>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-2">
                        <p className="text-sm" style={{ color: C.textMuted }}>Select a package to see your price</p>
                      </div>
                    )}
                  </div>

                  {/* CTA button */}
                  {step === 1 && (
                    <div className="px-5 pb-5">
                      <button
                        onClick={() => { if (isColorComplete()) { setStep(2); window.scrollTo({ top: 0, behavior: "instant" }); } }}
                        disabled={!isColorComplete()}
                        className="w-full rounded-xl py-4 font-bold text-lg border-none dark-btn"
                        style={{
                          background: isColorComplete() ? "#C9A84C" : "#E5E7EB",
                          color: isColorComplete() ? "#FFFFFF" : C.textMuted,
                          cursor: isColorComplete() ? "pointer" : "not-allowed",
                          ...bodyStyle,
                        }}>
                        {isColorComplete() ? "Secure Your Date →" : pkg ? "Select a color first" : "Choose a package above"}
                      </button>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="px-5 pb-5">
                      <button
                        onClick={handleCheckout}
                        disabled={!selectedDate || booking}
                        className="w-full rounded-xl py-3.5 font-semibold text-base border-none dark-btn"
                        style={{
                          background: selectedDate && !booking ? C.gold : "#E5E7EB",
                          color: selectedDate && !booking ? "#FFFFFF" : C.textMuted,
                          cursor: selectedDate && !booking ? "pointer" : "not-allowed",
                          ...bodyStyle,
                        }}>
                        {booking ? "Redirecting to payment…" : !selectedDate ? "Select a date first" : "Pay $50 Deposit & Book Date →"}
                      </button>
                      <p className="text-xs text-center mt-1.5" style={{ color: C.textMuted }}>
                        $50 deposit applied to your total — remaining balance due day of service.
                      </p>
                    </div>
                  )}
                </div>

                {/* Brand trust block */}
                <div className="rounded-2xl p-4 space-y-2.5" style={{ background: C.cardLight, border: `1px solid ${C.borderSubtle}` }}>
                  {[
                    "Licensed & fully insured",
                    "1,000+ fences restored",
                    "Eco-friendly, pet-safe products",
                    "(832) 334-6528",
                  ].map((text) => (
                    <div key={text} className="flex items-center gap-2.5">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: C.gold }} />
                      <p className="text-xs" style={{ color: C.creamDark }}>{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ MOBILE STICKY BAR (hidden on lg) ═══════════════════════════════ */}
        {step === 1 && pkg && (
          <div
            className="fixed bottom-0 left-0 right-0 z-50 px-4 lg:hidden"
            style={{
              background: "#4C4C4C",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              paddingBottom: "max(16px, env(safe-area-inset-bottom))",
            }}>
            <div className="max-w-lg mx-auto pt-3 pb-1">
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {colorChip()}
                    <p style={{ color: "rgba(255,255,255,0.6)" }} className="text-xs truncate">
                      {TIERS.find((t) => t.key === pkg)?.label} · {getColorDisplayName() || "Select a color"}
                    </p>
                  </div>
                  {tiers && (
                    <p style={{ color: "#FFFFFF", ...headingStyle }} className="font-bold text-xl leading-none">{fmt(tiers[pkg])}</p>
                  )}
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full shrink-0 font-medium"
                  style={{ background: "rgba(255,255,255,0.15)", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.25)" }}>
                  20% OFF
                </span>
              </div>
              <button
                onClick={() => { if (isColorComplete()) { setStep(2); window.scrollTo({ top: 0, behavior: "instant" }); } }}
                disabled={!isColorComplete()}
                className="w-full rounded-2xl py-4 font-bold text-lg border-none dark-btn"
                style={{
                  background: isColorComplete() ? "#C9A84C" : "rgba(255,255,255,0.2)",
                  color: isColorComplete() ? "#FFFFFF" : "rgba(255,255,255,0.4)",
                  cursor: isColorComplete() ? "pointer" : "not-allowed",
                  ...bodyStyle,
                }}>
                {isColorComplete() ? "Secure Your Date →" : "Select a color to continue"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="py-6 px-4 text-center" style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
          <p style={{ color: C.textMuted }} className="text-xs">
            © {new Date().getFullYear()} A&amp;T&apos;s Pressure Washing · Houston, TX ·{" "}
            <a href="tel:+18323346528" style={{ color: C.gold }} className="hover:underline">(832) 334-6528</a>
          </p>
          <p style={{ color: "#9CA3AF" }} className="text-[10px] mt-1">
            Serving Cypress · The Woodlands · Katy · Spring · Sugar Land &amp; surrounding areas
          </p>
        </div>
      </div>
    </>
  );
}
