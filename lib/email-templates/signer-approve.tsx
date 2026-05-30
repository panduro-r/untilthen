// Ask a registered multisig signer to approve a release (decrypt their share and publish it).
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components"
import * as s from "./styles"

type Props = { ownerName: string; approveUrl: string }

export default function SignerApprove({ ownerName, approveUrl }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Your approval is requested on a DeadDrop release</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Text style={s.brand}>DeadDrop</Text>
          <Text style={s.h1}>Your approval is requested</Text>
          <Text style={s.p}>
            A DeadDrop you&apos;re a signer on (set up by {ownerName}) is awaiting approvals to be
            released. You can approve when you judge the time is right.
          </Text>
          <Text style={s.p}>
            Open the page below, connect your wallet, and publish your approval. Once enough signers
            approve, the file becomes decryptable by its recipients.
          </Text>
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={approveUrl} style={s.button}>Review &amp; approve</Button>
          </Section>
          <Text style={s.small}>Or paste this link into your browser:</Text>
          <Text style={s.mono}><Link href={approveUrl} style={s.link}>{approveUrl}</Link></Text>
          <Hr style={s.hr} />
          <Text style={s.footer}>Generated automatically by DeadDrop. Approve only if you intend to release this drop.</Text>
        </Container>
      </Body>
    </Html>
  )
}
