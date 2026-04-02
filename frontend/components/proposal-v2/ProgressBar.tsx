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

const STEP_LABELS = ["HOA", "Color", "Package", "Schedule", "Deposit"];
const TOTAL_STEPS = STEP_LABELS.length;

// ─── Component ───────────────────────────────────────────────────────────────
interface ProgressBarProps {
  currentStep: number;
  onBack: () => void;
}

export default function ProgressBar({ currentStep, onBack }: ProgressBarProps) {
  const progressPct = Math.min((currentStep / TOTAL_STEPS) * 100, 100);
  const showBack = currentStep >= 1 && currentStep <= 5;

  return (
    <div
      style={{
        width: "100%",
        backgroundColor: V2.bg,
        padding: "16px 20px 12px",
      }}
    >
      {/* Top row: back arrow + step indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          marginBottom: 12,
          minHeight: 24,
        }}
      >
        {/* Back arrow */}
        {showBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: V2.textMuted,
              fontSize: 20,
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
              transition: "color 200ms ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = V2.text;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = V2.textMuted;
            }}
          >
            &larr;
          </button>
        )}

        {/* Step X of 5 */}
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: V2.textMuted,
            letterSpacing: "0.02em",
          }}
        >
          Step {currentStep} of {TOTAL_STEPS}
        </span>
      </div>

      {/* Progress track */}
      <div
        style={{
          width: "100%",
          height: 4,
          borderRadius: 2,
          backgroundColor: V2.surface,
          overflow: "hidden",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            borderRadius: 2,
            backgroundColor: V2.accent,
            transition: "width 400ms ease",
          }}
        />
      </div>

      {/* Step labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {STEP_LABELS.map((label, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum === currentStep;
          return (
            <span
              key={label}
              style={{
                fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? V2.accent : V2.textDim,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                transition: "color 300ms ease",
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
