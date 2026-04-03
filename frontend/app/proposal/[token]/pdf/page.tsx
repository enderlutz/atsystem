"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

export default function PdfProposalPage() {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    // Redirect to the raw PDF endpoint — browser renders it natively
    window.location.href = `/api/proposal/${token}/pdf-file`;
  }, [token]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4" />
        <p className="text-lg text-gray-600">Loading your proposal...</p>
      </div>
    </div>
  );
}
