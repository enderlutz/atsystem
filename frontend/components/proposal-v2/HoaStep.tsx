"use client";

import React from "react";

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

type HoaValue = "needs_approval" | "no_hoa" | "already_approved";

interface HoaStepProps {
  selected: HoaValue | null;
  onSelect: (value: HoaValue) => void;
}

const OPTIONS: { value: HoaValue; title: string; subtitle: string }[] = [
  {
    value: "needs_approval",
    title: "I need HOA approval first",
    subtitle: "My HOA needs to approve the color before work begins",
  },
  {
    value: "no_hoa",
    title: "No HOA / No approval needed",
    subtitle: "I can choose any color I want",
  },
  {
    value: "already_approved",
    title: "I already have HOA approval",
    subtitle: "My HOA approved a specific color for me",
  },
];

export default function HoaStep({ selected, onSelect }: HoaStepProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: V2.text,
          margin: 0,
          textAlign: "center",
        }}
      >
        Do you have a Homeowners Association (HOA)?
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                width: "100%",
                minHeight: 80,
                padding: 16,
                borderRadius: 12,
                border: `2px solid ${isSelected ? V2.accent : V2.surfaceBorder}`,
                background: V2.surface,
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.2s, box-shadow 0.2s",
                boxShadow: isSelected
                  ? `0 0 16px rgba(201, 149, 42, 0.25)`
                  : "none",
                outline: "none",
              }}
            >
              {/* Checkmark icon in top-right */}
              {isSelected && (
                <span
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: V2.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2.5 7L5.5 10L11.5 4"
                      stroke="#0A0A0F"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}

              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: V2.text,
                  lineHeight: 1.3,
                  paddingRight: isSelected ? 36 : 0,
                }}
              >
                {opt.title}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: V2.textMuted,
                  marginTop: 4,
                  lineHeight: 1.4,
                }}
              >
                {opt.subtitle}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
