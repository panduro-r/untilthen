export default function TrustBadge({ label = "End-to-end encrypted on your device" }: { label?: string }) {
  return (
    <span className="trust-badge">
      <span className="dot" />
      <span>{label}</span>
    </span>
  )
}
