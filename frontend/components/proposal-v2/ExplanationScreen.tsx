"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

const CHAR_DELAY_MS = 40;

// ─── Component ───────────────────────────────────────────────────────────────
interface ExplanationScreenProps {
  text: string;
  onContinue: () => void;
  onBack: () => void;
}

export default function ExplanationScreen({
  text,
  onContinue,
  onBack,
}: ExplanationScreenProps) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);

  // Reset when text prop changes
  useEffect(() => {
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;

    intervalRef.current = setInterval(() => {
      indexRef.current += 1;
      const next = text.slice(0, indexRef.current);
      setDisplayed(next);

      if (indexRef.current >= text.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setDone(true);
      }
    }, CHAR_DELAY_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text]);

  // Skip animation — show full text immediately
  const skipToEnd = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setDisplayed(text);
    setDone(true);
  }, [text]);

  const handleContinue = () => {
    if (!done) {
      skipToEnd();
    } else {
      onContinue();
    }
  };

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div
        style={{
          minHeight: "100dvh",
          backgroundColor: V2.bg,
          display: "flex",
          flexDirection: "column",
          padding: "0 20px 32px",
        }}
      >
        {/* Back arrow */}
        <div style={{ paddingTop: 20, paddingBottom: 8 }}>
          <button
            onClick={onBack}
            aria-label="Go back"
            style={{
              background: "none",
              border: "none",
              color: V2.textMuted,
              fontSize: 20,
              cursor: "pointer",
              padding: "4px 8px 4px 0",
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
        </div>

        {/* Typewriter body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.7,
              color: V2.text,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {displayed}
            {/* Blinking cursor while typing */}
            {!done && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1em",
                  backgroundColor: V2.accent,
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "blink 0.8s step-end infinite",
                }}
              />
            )}
          </p>
        </div>

        {/* Continue button — fades in when typewriter is done, or skip on tap */}
        <div
          style={{
            paddingTop: 24,
            opacity: done ? 1 : 0.4,
            animation: done ? "fadeIn 0.4s ease forwards" : "none",
          }}
        >
          <button
            onClick={handleContinue}
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
              transition: "background-color 200ms ease, opacity 200ms ease",
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
            Continue &rarr;
          </button>
        </div>
      </div>
    </>
  );
}
