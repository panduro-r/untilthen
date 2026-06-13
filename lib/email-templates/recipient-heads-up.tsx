// Sent at ARM time to a private recipient — an informational heads-up only. Carries NO secret and NO
// retrieval link (that one-time link is emailed separately when/if the safe actually releases).
import { Body, Container, Head, Hr, Html, Preview, Text } from "@react-email/components"
import * as s from "./styles"

type Props = {
  ownerName: string
  recipientName?: string
  mode: "timelock" | "multisig"
  triggerDate: Date | null
}

export default function RecipientHeadsUp({ ownerName, recipientName, mode, triggerDate }: Props) {
  const when = triggerDate
    ? triggerDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null
  return (
    <Html>
      <Head />
      <Preview>Someone you know named you as a recipient on Until Then</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Text style={s.brand}>Until Then</Text>
          <Text style={s.h1}>{recipientName ? `${recipientName}, you've` : "You've"} been named a recipient</Text>
          <Text style={s.p}>
            Someone you know used Until Then to set aside an encrypted file for you. There&apos;s nothing
            to do right now — this is just a heads-up so it won&apos;t come out of the blue later.
          </Text>
          <Text style={s.p}>
            {mode === "timelock"
              ? when
                ? `If they don't check in by ${when}, the file is released and you'll get a separate, one-time link by email to open it. They may push that date out.`
                : `When its time-lock releases, you'll get a separate, one-time link by email to open it.`
              : `When enough of a trusted group approve its release, you'll get a separate, one-time link by email to open it.`}
          </Text>
          <Text style={s.p}>
            No one at Until Then — or anyone who breaks into its servers — can read the file before then.
          </Text>
          <Hr style={s.hr} />
          <Text style={s.footer}>
            You received this because someone using Until Then (wallet {ownerName}) designated you as a
            recipient. It was generated automatically.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
