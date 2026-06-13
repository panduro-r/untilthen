// Wallet recipient retrieval notice — same shape, but retrieval requires a wallet signature.
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components"
import * as s from "./styles"

type Props = { ownerName: string; recipientName?: string; triggerDate: Date; retrievalUrl: string }

export default function RecipientWallet({ ownerName, recipientName, triggerDate, retrievalUrl }: Props) {
  const when = triggerDate.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC", timeZoneName: "short" })
  return (
    <Html>
      <Head />
      <Preview>Someone you know left an encrypted file for you</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Text style={s.brand}>Until Then</Text>
          <Text style={s.h1}>{recipientName ? `${recipientName}, someone` : "Someone"} you know left you an encrypted file</Text>
          <Text style={s.p}>
            Someone you know used Until Then to set aside an encrypted file for you, to be released if
            they did not check in by {when}. That moment has now passed.
          </Text>
          <Text style={s.p}>
            To open it, click below and connect the wallet you registered with. You&apos;ll be asked to
            sign a message — that signature decrypts your half of the key in your browser. No account needed.
          </Text>
          <Text style={s.warn}>This link can be used only once. Save the file as soon as you download it.</Text>
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={retrievalUrl} style={s.button}>Open the file</Button>
          </Section>
          <Text style={s.small}>If the button doesn&apos;t work, paste this link into your browser:</Text>
          <Text style={s.mono}><Link href={retrievalUrl} style={s.link}>{retrievalUrl}</Link></Text>
          <Hr style={s.hr} />
          <Text style={s.footer}>
            You received this because someone using Until Then (wallet {ownerName}) designated you as a
            recipient. It was generated automatically; no one at Until Then has read its contents.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
