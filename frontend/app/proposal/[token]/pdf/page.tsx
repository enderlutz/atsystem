import { redirect } from "next/navigation";

// Server component — redirects directly to Railway backend, bypassing Vercel's proxy.
// Vercel's rewrite proxy buffers large responses and has size limits (~4.5MB),
// so a 4.7MB PDF must go direct to the backend.
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function PdfProposalPage({ params }: { params: { token: string } }) {
  const target = BACKEND_URL
    ? `${BACKEND_URL}/api/proposal/${params.token}/pdf-file`
    : `/api/proposal/${params.token}/pdf-file`;
  redirect(target);
}
