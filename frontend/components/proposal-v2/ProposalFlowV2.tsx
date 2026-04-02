"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DM_Sans, Playfair_Display } from "next/font/google";
import type { ProposalData } from "@/lib/api";

// ─── Step components ─────────────────────────────────────────────────────────
import GreetingScreen from "@/components/proposal-v2/GreetingScreen";
import HoaStep from "@/components/proposal-v2/HoaStep";
import ColorStep from "@/components/proposal-v2/ColorStep";
import PackageStep from "@/components/proposal-v2/PackageStep";
import ExplanationScreen from "@/components/proposal-v2/ExplanationScreen";
import ProgressBar from "@/components/proposal-v2/ProgressBar";

// Future components (will be created by another agent)
import ScheduleStep from "@/components/proposal-v2/ScheduleStep";
import DepositPlaceholder from "@/components/proposal-v2/DepositPlaceholder";

// ─── Fonts ───────────────────────────────────────────────────────────────────
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-playfair",
});

// ─── Design tokens ───────────────────────────────────────────────────────────
export const V2 = {
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

// ─── State type ──────────────────────────────────────────────────────────────
export type V2State = {
  hoaStatus: "needs_approval" | "no_hoa" | "already_approved" | null;
  selectedColor: string | null;
  approvedColorText: string | null;
  selectedPackage: "essential" | "signature" | "legacy" | null;
  selectedDate: string | null;
  currentStep: number; // 0=greeting, 1-5=steps
  showExplanation: boolean;
};

// ─── Props ───────────────────────────────────────────────────────────────────
interface ProposalFlowV2Props {
  proposal: ProposalData;
  token: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const TOTAL_STEPS = 5;

const EXPLANATION_TEXT: Record<number, string> = {
  1: "Your HOA (Homeowners Association) may have rules about what stain colors are allowed on your fence. If you're not sure, it's best to check with them first. We can help guide you through that process.",
  2: "The stain color you choose affects the look and longevity of your fence. Semi-transparent stains let the wood grain show through, while solid stains provide full, even coverage. Both protect your wood from the Texas sun.",
  3: "Each package uses a different type of stain. Essential uses a clear sealant, Signature uses a semi-transparent stain for even coverage, and Legacy uses a solid stain that showcases the natural beauty of your wood.",
};

// ─── CSS animation keyframes ─────────────────────────────────────────────────
const ANIMATION_CSS = `
  @keyframes v2SlideLeft {
    from { transform: translateX(-100%); opacity: 0; }
    to   { transform: translateX(0);     opacity: 1; }
  }
  @keyframes v2SlideRight {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  .v2-slide-left {
    animation: v2SlideLeft 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  }
  .v2-slide-right {
    animation: v2SlideRight 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  }
`;

export function ProposalFlowV2({ proposal, token }: ProposalFlowV2Props) {
  // ─── Flow state ──────────────────────────────────────────────────────────
  const [state, setState] = useState<V2State>({
    hoaStatus: null,
    selectedColor: null,
    approvedColorText: null,
    selectedPackage: null,
    selectedDate: null,
    currentStep: 0,
    showExplanation: false,
  });

  // ─── Animation direction tracking ────────────────────────────────────────
  const [animDirection, setAnimDirection] = useState<"left" | "right" | null>(null);
  const animTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear animation class after it plays
  useEffect(() => {
    if (animDirection) {
      if (animTimeout.current) clearTimeout(animTimeout.current);
      animTimeout.current = setTimeout(() => setAnimDirection(null), 400);
    }
    return () => {
      if (animTimeout.current) clearTimeout(animTimeout.current);
    };
  }, [animDirection]);

  // ─── Derive tier prices ──────────────────────────────────────────────────
  const tiers = proposal.tiers ?? proposal.sections?.[0]?.tiers ?? {
    essential: 0,
    signature: 0,
    legacy: 0,
  };

  const previouslyStained = proposal.previously_stained ?? undefined;

  // ─── Step navigation callbacks ───────────────────────────────────────────
  const onNext = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, TOTAL_STEPS),
      showExplanation: false,
    }));
    setAnimDirection("right");
  }, []);

  const onBack = useCallback(() => {
    setState((prev) => {
      if (prev.showExplanation) {
        return { ...prev, showExplanation: false };
      }
      return {
        ...prev,
        currentStep: Math.max(prev.currentStep - 1, 0),
        showExplanation: false,
      };
    });
    setAnimDirection("left");
  }, []);

  const onShowExplanation = useCallback(() => {
    setState((prev) => ({ ...prev, showExplanation: true }));
    setAnimDirection("right");
  }, []);

  // ─── State update helper ─────────────────────────────────────────────────
  const updateState = useCallback((patch: Partial<V2State>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // ─── Render current step ────────────────────────────────────────────────
  function renderStep() {
    const { currentStep, showExplanation } = state;

    // Steps 1-3 can show explanation overlay
    if (showExplanation && currentStep >= 1 && currentStep <= 3) {
      return (
        <ExplanationScreen
          text={EXPLANATION_TEXT[currentStep] || ""}
          onContinue={() => setState((prev) => ({ ...prev, showExplanation: false }))}
          onBack={onBack}
        />
      );
    }

    switch (currentStep) {
      case 0:
        return (
          <GreetingScreen
            onStart={onNext}
          />
        );
      case 1:
        return (
          <HoaStep
            selected={state.hoaStatus}
            onSelect={(value: "needs_approval" | "no_hoa" | "already_approved") => {
              updateState({ hoaStatus: value });
              // Auto-advance after selection
              setTimeout(onNext, 300);
            }}
          />
        );
      case 2:
        return (
          <ColorStep
            state={state}
            updateState={updateState}
            onNext={onNext}
            onBack={onBack}
            onShowExplanation={onShowExplanation}
            selectedPackage={state.selectedPackage}
            previouslyStained={previouslyStained}
          />
        );
      case 3:
        return (
          <PackageStep
            state={state}
            updateState={updateState}
            tiers={tiers}
            onNext={onNext}
            onBack={onBack}
            onShowExplanation={onShowExplanation}
            previouslyStained={previouslyStained}
          />
        );
      case 4:
        return (
          <ScheduleStep
            state={state}
            updateState={updateState}
            token={token}
            onNext={onNext}
            onBack={onBack}
          />
        );
      case 5:
        return (
          <DepositPlaceholder
            state={state}
            proposal={proposal}
            tiers={tiers}
            token={token}
            onBack={onBack}
          />
        );
      default:
        return null;
    }
  }

  // ─── Animation class for the step container ──────────────────────────────
  const animClass =
    animDirection === "right"
      ? "v2-slide-right"
      : animDirection === "left"
        ? "v2-slide-left"
        : "";

  return (
    <div
      className={`${dmSans.variable} ${playfair.variable}`}
      style={{
        fontFamily: "var(--font-dm-sans), sans-serif",
        minHeight: "100vh",
        background: V2.bg,
        color: V2.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <style>{ANIMATION_CSS}</style>

      {/* Progress bar — shown on steps 1-5, not greeting */}
      {state.currentStep >= 1 && (
        <ProgressBar
          currentStep={state.currentStep}
          onBack={onBack}
        />
      )}

      {/* Step content container */}
      <div
        key={`${state.currentStep}-${state.showExplanation}`}
        className={animClass}
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "0 20px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {renderStep()}
      </div>
    </div>
  );
}
