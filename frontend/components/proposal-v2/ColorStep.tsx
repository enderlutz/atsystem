"use client";

import React, { useState } from "react";
import {
  getColorsForTier,
  getHoaColorsForTier,
  ALL_STAIN_COLORS,
  HOA_COLORS,
} from "@/lib/proposal-shared";
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

interface ColorStepProps {
  state: V2State;
  updateState: (patch: Partial<V2State>) => void;
  onNext: () => void;
  onBack: () => void;
  onShowExplanation: () => void;
  selectedPackage: "essential" | "signature" | "legacy" | null;
  previouslyStained?: string;
}

export default function ColorStep({
  state,
  updateState,
  onNext,
  selectedPackage,
}: ColorStepProps) {
  const [hoveredHoa, setHoveredHoa] = useState<string | null>(null);

  const hoaStatus = state.hoaStatus;
  const selectedColor = state.selectedColor;
  const approvedColorText = state.approvedColorText;

  const onSelectColor = (color: string) => {
    updateState({ selectedColor: color });
    // Auto-advance after 400ms
    setTimeout(onNext, 400);
  };

  const onSetApprovedText = (text: string) => {
    updateState({ approvedColorText: text });
  };

  const onContinue = () => {
    onNext();
  };

  // Mode B: already_approved
  if (hoaStatus === "already_approved") {
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
          What color did your HOA approve?
        </h2>

        <input
          type="text"
          value={approvedColorText ?? ""}
          onChange={(e) => onSetApprovedText(e.target.value)}
          placeholder="e.g. Sherwin-Williams Slate Tile, #8B7355"
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 12,
            border: `1px solid ${V2.surfaceBorder}`,
            background: V2.surface,
            color: V2.text,
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = V2.accent;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = V2.surfaceBorder;
          }}
        />

        <p
          style={{
            fontSize: 14,
            color: V2.textMuted,
            margin: 0,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Don&apos;t worry if you&apos;re not sure — we&apos;ll confirm before we start.
        </p>

        <button
          type="button"
          onClick={onContinue}
          disabled={!approvedColorText?.trim()}
          style={{
            width: "100%",
            padding: "14px 24px",
            borderRadius: 12,
            border: "none",
            background:
              approvedColorText?.trim() ? V2.accent : V2.textDim,
            color: approvedColorText?.trim() ? "#0A0A0F" : V2.textMuted,
            fontSize: 16,
            fontWeight: 700,
            cursor: approvedColorText?.trim() ? "pointer" : "not-allowed",
            transition: "background 0.2s",
            opacity: approvedColorText?.trim() ? 1 : 0.6,
          }}
        >
          Continue &rarr;
        </button>
      </div>
    );
  }

  // Mode A: no_hoa or needs_approval
  const galleryColors = selectedPackage
    ? getColorsForTier(selectedPackage)
    : ALL_STAIN_COLORS;

  const hoaSwatches =
    hoaStatus === "needs_approval" && selectedPackage
      ? getHoaColorsForTier(selectedPackage)
      : hoaStatus === "needs_approval"
        ? HOA_COLORS
        : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ textAlign: "center" }}>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: V2.text,
            margin: 0,
          }}
        >
          Choose your fence color
        </h2>
        <p
          style={{
            fontSize: 15,
            color: V2.textMuted,
            margin: "6px 0 0",
          }}
        >
          Pick the look that feels like home.
        </p>
      </div>

      {/* Gallery color image cards */}
      {galleryColors.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {galleryColors.map((color) => {
            const isSelected = selectedColor === color.name;
            return (
              <button
                key={color.id}
                type="button"
                onClick={() => onSelectColor(color.name)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  background: "transparent",
                  border: `2px solid ${isSelected ? V2.accent : "transparent"}`,
                  borderRadius: 12,
                  padding: 6,
                  cursor: "pointer",
                  outline: "none",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                  boxShadow: isSelected
                    ? `0 0 12px rgba(201, 149, 42, 0.3)`
                    : "none",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: V2.surface,
                  }}
                >
                  <img
                    src={color.src}
                    alt={color.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: isSelected ? V2.accent : V2.textMuted,
                    marginTop: 6,
                    textAlign: "center",
                    fontWeight: isSelected ? 600 : 400,
                    lineHeight: 1.2,
                  }}
                >
                  {color.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* HOA hex swatches */}
      {hoaSwatches.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p
            style={{
              fontSize: 14,
              color: V2.textMuted,
              margin: "0 0 10px",
              fontWeight: 600,
            }}
          >
            HOA-Approved Colors
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {hoaSwatches.map((swatch) => {
              const isSelected = selectedColor === swatch.name;
              return (
                <div
                  key={swatch.name}
                  style={{ position: "relative", display: "inline-block" }}
                  onMouseEnter={() => setHoveredHoa(swatch.name)}
                  onMouseLeave={() => setHoveredHoa(null)}
                >
                  <button
                    type="button"
                    onClick={() => onSelectColor(swatch.name)}
                    title={swatch.name}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      border: `2px solid ${isSelected ? V2.accent : V2.surfaceBorder}`,
                      background: swatch.hex,
                      cursor: "pointer",
                      outline: "none",
                      transition: "border-color 0.2s, box-shadow 0.2s",
                      boxShadow: isSelected
                        ? `0 0 12px rgba(201, 149, 42, 0.35)`
                        : "none",
                      padding: 0,
                    }}
                  />
                  {/* Tooltip on hover */}
                  {hoveredHoa === swatch.name && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 6px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: V2.surface,
                        border: `1px solid ${V2.surfaceBorder}`,
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        color: V2.text,
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        zIndex: 10,
                      }}
                    >
                      {swatch.name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
