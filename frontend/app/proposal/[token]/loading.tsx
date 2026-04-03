export default function ProposalLoading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F8F9FA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="text-center space-y-4">
        <div
          className="h-10 w-10 rounded-full border-2 border-t-transparent animate-spin mx-auto"
          style={{ borderColor: "#1C2235", borderTopColor: "transparent" }}
        />
        <p style={{ color: "#9CA3AF", fontFamily: "'DM Sans', sans-serif" }} className="text-sm">
          Loading your proposal...
        </p>
      </div>
    </div>
  );
}
