"use client";

import type { ProposalData } from "@/lib/api";
import { fmt, fmtMonthly, TIER_INFO } from "@/lib/proposal-shared";
import { V2, type V2State } from "./ProposalFlowV2";

interface Props {
  state: V2State;
  proposal: ProposalData;
  tiers: { essential: number; signature: number; legacy: number };
  token: string;
  onBack: () => void;
}

export default function DepositPlaceholder({ state, proposal, tiers, onBack }: Props) {
  const tierInfo = TIER_INFO.find((t) => t.key === state.selectedPackage);
  const price = state.selectedPackage ? tiers[state.selectedPackage] : 0;
  const selectedDateDisplay = state.selectedDate
    ? new Date(state.selectedDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "Not selected";

  const hoaLabels = {
    needs_approval: "Needs HOA approval",
    no_hoa: "No HOA",
    already_approved: "HOA pre-approved",
  };

  const colorDisplay =
    state.approvedColorText || state.selectedColor || "Not selected";

  return (
    <div style={{ padding: "0 16px 32px" }}>
      <h2
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: 26,
          fontWeight: 600,
          color: V2.text,
          marginBottom: 8,
        }}
      >
        You're almost done.
      </h2>
      <p style={{ color: V2.textMuted, fontSize: 15, marginBottom: 24, lineHeight: 1.5 }}>
        Here's a summary of your selections.
      </p>

      {/* Summary card */}
      <div
        style={{
          background: V2.surface,
          border: `1px solid ${V2.surfaceBorder}`,
          borderRadius: 16,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SummaryRow label="Customer" value={proposal.customer_name || "—"} />
          <SummaryRow label="HOA Status" value={state.hoaStatus ? hoaLabels[state.hoaStatus] : "—"} />
          <SummaryRow label="Color" value={colorDisplay} />
          <SummaryRow
            label="Package"
            value={tierInfo ? `${tierInfo.label} — ${fmt(price)}` : "—"}
          />
          {price > 0 && (
            <SummaryRow label="Monthly" value={fmtMonthly(price) + " for 21 months"} />
          )}
          <SummaryRow label="Preferred Date" value={selectedDateDisplay} />
        </div>
      </div>

      {/* Deposit placeholder */}
      <div
        style={{
          background: V2.accent + "10",
          border: `1px dashed ${V2.accent}60`,
          borderRadius: 16,
          padding: 24,
          textAlign: "center",
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>&#128274;</div>
        <p style={{ color: V2.text, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          Deposit Integration Coming Soon
        </p>
        <p style={{ color: V2.textMuted, fontSize: 14, lineHeight: 1.5 }}>
          Secure your spot with a $50 deposit. The remainder is due on completion.
        </p>
      </div>

      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          width: "100%",
          padding: "14px 0",
          borderRadius: 12,
          border: `1px solid ${V2.surfaceBorder}`,
          background: "transparent",
          color: V2.textMuted,
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 200ms ease",
        }}
      >
        &larr; Go Back
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: V2.textMuted, fontSize: 14 }}>{label}</span>
      <span style={{ color: V2.text, fontSize: 14, fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>
        {value}
      </span>
    </div>
  );
}
