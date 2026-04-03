"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function PdfProposalPage() {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    // Redirect directly to Railway backend — bypasses Vercel proxy size limits.
    // The loading screen stays visible until the browser's PDF viewer takes over.
    const target = BACKEND_URL
      ? `${BACKEND_URL}/api/proposal/${token}/pdf-file`
      : `/api/proposal/${token}/pdf-file`;
    window.location.href = target;
  }, [token]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1C2235 0%, #2D3548 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {/* Logo / Brand */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          A&T Fence Restoration
        </div>
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.5)",
            marginBottom: 40,
          }}
        >
          Pressure Washing & Fence Staining
        </div>

        {/* Spinner */}
        <div
          style={{
            width: 48,
            height: 48,
            border: "3px solid rgba(255,255,255,0.15)",
            borderTopColor: "#cf9d52",
            borderRadius: "50%",
            margin: "0 auto 24px",
            animation: "spin 0.8s linear infinite",
          }}
        />

        <div style={{ fontSize: 16, color: "#FFFFFF", fontWeight: 500, maxWidth: 320, margin: "0 auto", lineHeight: 1.6 }}>
          We can&apos;t wait to work with you! We&apos;re loading up your proposal now.
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.45)",
            marginTop: 16,
          }}
        >
          Questions? Call us at{" "}
          <a href="tel:+18323346528" style={{ color: "#cf9d52", textDecoration: "none" }}>
            (832) 334-6528
          </a>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
