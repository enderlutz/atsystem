"use client";

// ─── Design tokens ───────────────────────────────────────────────────────────
const V2 = {
  bg: "#0A0A0F",
  surface: "#13131A",
  surfaceBorder: "rgba(255,255,255,0.08)",
  accent: "#C9952A",
  accentLight: "#D4A94E",
  text: "#F0EDE8",
  textMuted: "#8A8580",
  textDim: "#5A5550",
  success: "#22C55E",
};

// ─── Component ───────────────────────────────────────────────────────────────
interface GreetingScreenProps {
  onStart: () => void;
}

export default function GreetingScreen({ onStart }: GreetingScreenProps) {
  return (
    <>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          minHeight: "100dvh",
          backgroundColor: V2.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 20px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 24,
          }}
        >
          {/* Brand name */}
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: V2.accent,
              margin: 0,
              opacity: 0,
              animation: "fadeSlideUp 0.6s ease forwards",
              animationDelay: "0s",
            }}
          >
            A&T&rsquo;s Fence Restoration
          </p>

          {/* Heading */}
          <h1
            style={{
              fontSize: 28,
              fontWeight: 400,
              lineHeight: 1.3,
              color: V2.text,
              fontFamily: "Georgia, 'Times New Roman', serif",
              margin: 0,
              opacity: 0,
              animation: "fadeSlideUp 0.6s ease forwards",
              animationDelay: "0.15s",
            }}
          >
            Your Fence Transformation Starts Here
          </h1>

          {/* Subheading */}
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.6,
              color: V2.textMuted,
              margin: 0,
              maxWidth: 340,
              opacity: 0,
              animation: "fadeSlideUp 0.6s ease forwards",
              animationDelay: "0.3s",
            }}
          >
            We&rsquo;ll walk you through everything &mdash; it only takes about 2
            minutes.
          </p>

          {/* CTA button */}
          <button
            onClick={onStart}
            style={{
              width: "100%",
              height: 48,
              border: "none",
              borderRadius: 12,
              backgroundColor: V2.accent,
              color: V2.bg,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              opacity: 0,
              animation: "fadeSlideUp 0.6s ease forwards",
              animationDelay: "0.45s",
              transition: "background-color 200ms ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                V2.accentLight;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                V2.accent;
            }}
          >
            Let&rsquo;s Get Started &rarr;
          </button>
        </div>
      </div>
    </>
  );
}
