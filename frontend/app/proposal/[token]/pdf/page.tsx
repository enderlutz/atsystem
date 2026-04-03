import { redirect } from "next/navigation";

// Server component — no JS bundle sent to the browser.
// Immediately redirects to the raw PDF endpoint so the browser's native PDF viewer opens it.
export default function PdfProposalPage({ params }: { params: { token: string } }) {
  redirect(`/api/proposal/${params.token}/pdf-file`);
}
