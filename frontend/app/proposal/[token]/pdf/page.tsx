"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getBaseUrl(token: string) {
  const base = BACKEND_URL || "";
  return `${base}/api/proposal/${token}`;
}

export default function PdfProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getBaseUrl(token)}/pdf-info`)
      .then((r) => {
        if (!r.ok) throw new Error("Proposal not found");
        return r.json();
      })
      .then((data) => setPageCount(data.page_count))
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: "center", padding: 40 }}>
          <h1 style={{ color: "#FFF", fontSize: 24, fontWeight: 700 }}>Proposal not found</h1>
          <p style={{ color: "rgba(255,255,255,0.5)", marginTop: 12 }}>
            This link may have expired.{" "}
            <a href="tel:+18323346528" style={{ color: "#cf9d52" }}>(832) 334-6528</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#FFF" }}>A&T Fence Restoration</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Your Proposal</div>
      </div>

      {/* Pages */}
      <div style={styles.pages}>
        {pageCount === null ? (
          <div style={styles.loading}>
            <div style={styles.spinner} />
            <p style={{ color: "#FFF", fontSize: 16, fontWeight: 500, maxWidth: 300, margin: "0 auto", lineHeight: 1.6 }}>
              We can&apos;t wait to work with you! Loading your proposal now...
            </p>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 12 }}>
              Questions? Call{" "}
              <a href="tel:+18323346528" style={{ color: "#cf9d52", textDecoration: "none" }}>(832) 334-6528</a>
            </p>
          </div>
        ) : (
          Array.from({ length: pageCount }, (_, i) => (
            <PageImage key={i} token={token} pageNum={i} priority={i === 0} />
          ))
        )}
      </div>

      {/* Footer */}
      {pageCount !== null && (
        <div style={styles.footer}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
            Questions? Call us at{" "}
            <a href="tel:+18323346528" style={{ color: "#cf9d52", textDecoration: "none" }}>(832) 334-6528</a>
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

function PageImage({ token, pageNum, priority }: { token: string; pageNum: number; priority: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const src = `${getBaseUrl(token)}/pdf-page/${pageNum}`;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 800, margin: "0 auto 12px" }}>
      {!loaded && (
        <div style={{
          background: "#1a1f30",
          borderRadius: 8,
          height: priority ? 500 : 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={styles.spinnerSmall} />
        </div>
      )}
      <img
        src={src}
        alt={`Page ${pageNum + 1}`}
        loading={priority ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)}
        style={{
          width: "100%",
          borderRadius: 8,
          display: loaded ? "block" : "none",
          animation: "fadeIn 0.3s ease",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#12151f",
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  header: {
    textAlign: "center" as const,
    padding: "20px 16px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  pages: {
    padding: "16px 12px",
  },
  loading: {
    textAlign: "center" as const,
    padding: "120px 20px",
  },
  footer: {
    textAlign: "center" as const,
    padding: "20px 16px 40px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  spinner: {
    width: 48,
    height: 48,
    border: "3px solid rgba(255,255,255,0.15)",
    borderTopColor: "#cf9d52",
    borderRadius: "50%",
    margin: "0 auto 24px",
    animation: "spin 0.8s linear infinite",
  },
  spinnerSmall: {
    width: 24,
    height: 24,
    border: "2px solid rgba(255,255,255,0.15)",
    borderTopColor: "#cf9d52",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};
