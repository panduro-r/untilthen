"use client"

// Dev-only visual gallery of the primitive components. Not linked in nav; useful for verifying the
// design tokens render correctly. Safe to delete once the real pages exist.
import { useState } from "react"
import { Button, Card, Input, Chip, Steps, Eyebrow, TrustBadge, ProgressBar, Countdown } from "@/components/ui"

export default function Preview() {
  // Capture "now" once (calling Date.now() directly in render is impure).
  const [base] = useState(() => Date.now())
  return (
    <div className="page page-narrow stack-32">
      <div className="stack-8">
        <Eyebrow>Component preview</Eyebrow>
        <h1 className="h-1">Design primitives</h1>
        <p className="text-body">Verifying tokens, fonts, and the component vocabulary.</p>
      </div>

      <Card style={{ padding: 24 }} className="stack-16">
        <h2 className="h-2">Buttons</h2>
        <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <Button>Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card style={{ padding: 24 }} className="stack-16">
        <h2 className="h-2">Chips</h2>
        <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <Chip tone="armed">Armed</Chip>
          <Chip tone="released">Released</Chip>
          <Chip tone="triggered">Triggered</Chip>
          <Chip tone="expired">Expired</Chip>
          <Chip tone="ok">Registered</Chip>
          <Chip>Default</Chip>
        </div>
      </Card>

      <Card style={{ padding: 24 }} className="stack-16">
        <h2 className="h-2">Steps</h2>
        <Steps current={1} steps={["Encrypt", "Condition", "Confirm", "Armed"]} />
      </Card>

      <Card style={{ padding: 24 }} className="stack-16">
        <h2 className="h-2">Inputs</h2>
        <Input label="Drop title" placeholder="Estate documents" />
        <Input label="Wallet address" mono placeholder="0x7f3a…c5d6" hint="Aptos address of the recipient" />
      </Card>

      <Card style={{ padding: 24 }} className="stack-16">
        <h2 className="h-2">Progress &amp; countdown</h2>
        <ProgressBar value={0.35} />
        <ProgressBar value={0.7} tone="amber" />
        <ProgressBar value={0.95} tone="red" />
        <div className="row" style={{ alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <Countdown to={base + 9 * 86_400_000} />
          <Countdown to={base + 26 * 3_600_000} />
        </div>
        <Countdown to={base + 3 * 86_400_000 + 4 * 3_600_000} big />
        <TrustBadge />
      </Card>
    </div>
  )
}
