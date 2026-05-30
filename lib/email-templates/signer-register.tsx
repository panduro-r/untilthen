// Ask a multisig signer to register (connect wallet, establish their BLS key share).
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components"
import * as s from "./styles"

type Props = { ownerName: string; registerUrl: string }

export default function SignerRegister({ ownerName, registerUrl }: Props) {
  return (
    <Html>
      <Head />
      <Preview>{ownerName} asked you to be a signer on DeadDrop</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Text style={s.brand}>DeadDrop</Text>
          <Text style={s.h1}>{ownerName} asked you to be a signer</Text>
          <Text style={s.p}>
            {ownerName} set up an encrypted drop that is released only when a threshold of trusted
            signers approve. They&apos;ve named you as one of those signers.
          </Text>
          <Text style={s.p}>
            To accept, connect your wallet on the page below and sign once. This registers your
            approval key — you won&apos;t be asked to release anything yet.
          </Text>
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={registerUrl} style={s.button}>Register as a signer</Button>
          </Section>
          <Text style={s.small}>Or paste this link into your browser:</Text>
          <Text style={s.mono}><Link href={registerUrl} style={s.link}>{registerUrl}</Link></Text>
          <Hr style={s.hr} />
          <Text style={s.footer}>Generated automatically by DeadDrop on behalf of {ownerName}.</Text>
        </Container>
      </Body>
    </Html>
  )
}
