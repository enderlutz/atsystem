"use client";

import React from "react";
import { TIER_INFO, fmt, fmtMonthly, strikethrough } from "@/lib/proposal-shared";
import type { V2State } from "@/components/proposal-v2/ProposalFlowV2";

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

type TierKey = "essential" | "signature" | "legacy";

interface PackageStepProps {
  state: V2State;
  updateState: (patch: Partial<V2State>) => void;
  tiers: { essential: number; signature: number; legacy: number };
  onNext: () => void;
  onBack: () => void;
  onShowExplanation: () => void;
  previouslyStained?: string;
}

export default function PackageStep({
  state,
  updateState,
  tiers,
  onNext,
  previouslyStained,
}: PackageStepProps) {
  const selected = state.selectedPackage;
  const isPreviouslyStained = previouslyStained === "yes" || previouslyStained === "true";

  const onSelect = (tier: TierKey) => {
    updateState({ selectedPackage: tier });
    // Auto-advance after 400ms
    setTimeout(onNext, 400);
  };

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
        Choose your package
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        {TIER_INFO.map((tier) => {
          const price = tiers[tier.key];
          const isSelected = selected === tier.key;
          const isDisabled = tier.key === "essential" && isPreviouslyStained;

          return (
            <button
              key={tier.key}
              type="button"
              onClick={() => {
                if (!isDisabled) onSelect(tier.key);
              }}
              disabled={isDisabled}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                width: "100%",
                padding: 16,
                borderRadius: 12,
                border: `2px solid ${isSelected ? V2.accent : V2.surfaceBorder}`,
                background: V2.surface,
                cursor: isDisabled ? "not-allowed" : "pointer",
                textAlign: "left",
                transition: "border-color 0.2s, box-shadow 0.2s",
                boxShadow: isSelected
                  ? `0 0 16px rgba(201, 149, 42, 0.25)`
                  : "none",
                outline: "none",
                opacity: isDisabled ? 0.5 : 1,
              }}
            >
              {/* Checkmark in top-right when selected */}
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

              {/* Header row: label + badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  paddingRight: isSelected ? 36 : 0,
                }}
              >
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: V2.text,
                  }}
                >
                  {tier.label}
                </span>
                {tier.badge && (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: `${V2.accent}22`,
                      color: V2.accent,
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tier.badge}
                  </span>
                )}
              </div>

              {/* Pricing */}
              <div style={{ marginTop: 10 }}>
                <span
                  style={{
                    fontSize: 14,
                    color: V2.textDim,
                    textDecoration: "line-through",
                    marginRight: 8,
                  }}
                >
                  {strikethrough(price)}
                </span>
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    color: V2.text,
                  }}
                >
                  {fmt(price)}
                </span>
              </div>
              <span
                style={{
                  fontSize: 13,
                  color: V2.textMuted,
                  marginTop: 2,
                }}
              >
                {fmtMonthly(price)}
              </span>

              {/* Disabled message for Essential when previously stained */}
              {isDisabled && (
                <p
                  style={{
                    fontSize: 13,
                    color: V2.accentLight,
                    margin: "10px 0 0",
                    fontStyle: "italic",
                    lineHeight: 1.4,
                  }}
                >
                  Not available for previously stained fences
                </p>
              )}

              {/* Feature list */}
              <ul
                style={{
                  listStyle: "none",
                  margin: "12px 0 0",
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {tier.features.map((feature, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 14,
                      color: V2.textMuted,
                      lineHeight: 1.4,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      style={{ flexShrink: 0, marginTop: 2 }}
                    >
                      <path
                        d="M3 8L6.5 11.5L13 5"
                        stroke={V2.accent}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}
