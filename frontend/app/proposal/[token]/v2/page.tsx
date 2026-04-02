"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type ProposalData } from "@/lib/api";
import { ProposalFlowV2 } from "@/components/proposal-v2/ProposalFlowV2";

export default function ProposalV2Page() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<ProposalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    api
      .getProposal(token)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Proposal not found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0A0A0F",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            border: "3px solid rgba(255,255,255,0.1)",
            borderTopColor: "#C9952A",
            borderRadius: "50%",
            animation: "v2-spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes v2-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Error / not found state
  if (error || !data) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0A0A0F",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(220,38,38,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 24,
            }}
          >
            !
          </div>
          <h1
            style={{
              color: "#F0EDE8",
              fontSize: 20,
              fontWeight: 600,
              margin: "0 0 8px",
            }}
          >
            Proposal Not Found
          </h1>
          <p style={{ color: "#8A8580", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            {error || "This proposal link may have expired or is no longer available. Please contact us for assistance."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F" }}>
      <ProposalFlowV2 proposal={data} token={token} />
    </div>
  );
}
