import type { Metadata } from "next"
import Link from "next/link"
import { Eyebrow } from "@/components/ui"

export const metadata: Metadata = {
  title: "FAQ — Until Then",
  description: "Plain-language answers about how Until Then encrypts, stores, and releases your files.",
}

export default function FaqPage() {
  return (
    <div className="page page-narrow stack-32">
      <div className="stack-12">
        <Eyebrow>Questions &amp; answers</Eyebrow>
        <h1 className="h-1">How Until Then works</h1>
        <p className="text-body" style={{ maxWidth: 620 }}>
          Short, honest answers to the questions people ask most. If you want the full threat model,
          read the <Link href="/security">Security page</Link>.
        </p>
      </div>

      <Section title="The basics">
        <QA q="What is Until Then?">
          A dead man&apos;s switch for files. You seal a file now, choose what should release it, and we
          keep it locked until that moment comes. If you go quiet, or a group you trust decides the
          time is right, the file opens for the people you picked. Until then, no one can read it. Not
          even us.
        </QA>
        <QA q="When would I use it?">
          When something should surface only if you are not around to handle it yourself. A letter to
          family, account access for next of kin, source files for a journalist, documents meant to
          open on a set date. Anything you want held safely without trusting a company to hold the
          actual contents.
        </QA>
        <QA q="Do I need to understand crypto to use it?">
          No. To create a safe you connect a wallet (Petra, on Aptos) and sign a couple of messages.
          That is the whole setup. The people who receive your file usually need nothing at all. They
          click a link and the file decrypts in their browser.
        </QA>
      </Section>

      <Section title="How encryption works">
        <QA q="How is my file encrypted?">
          It happens entirely in your browser, before anything is uploaded. We generate a random key
          and encrypt the file with AES-256-GCM, the same standard used to protect sensitive data
          across the industry. The plaintext never leaves your device. What gets uploaded is
          ciphertext: a scrambled blob that is useless without the key.
        </QA>
        <QA q="So where does the key go? This is the important part.">
          The key is split into two halves, and no single party ever holds both. One half is locked by
          your condition, either a time-lock or a group of signers. The other half is wrapped so that
          only your chosen recipient can unwrap it. The file opens only when both halves come together,
          and that can only happen once the condition is met. Our servers store the locked pieces, never
          a usable key. Dump our entire database and you still cannot decrypt a thing.
        </QA>
        <QA q="What is AES-256-GCM, in plain words?">
          A well-tested, widely trusted way to scramble data so it can only be read with the right key.
          The 256 is the key size, far beyond what brute force can reach. The GCM part also checks the
          file has not been tampered with: change a single byte of the ciphertext and decryption fails
          rather than handing back something altered.
        </QA>
        <QA q="Can someone break the encryption?">
          Not by attacking the math. AES-256 does not get brute-forced. The real risks live elsewhere,
          like a compromised device while you encrypt, or a recipient&apos;s email account being taken
          over so someone else clicks their link first. We lay those out plainly on the{" "}
          <Link href="/security">Security page</Link>.
        </QA>
      </Section>

      <Section title="How decryption works">
        <QA q="What happens when the condition is met?">
          The recipient gets a one-time link. Opening it pulls the ciphertext from storage along with
          the now-unlocked key material, reassembles the key in their browser, decrypts the file
          locally, and hands them the download. The decryption runs on their device. We never see the
          key or the file at any point.
        </QA>
        <QA q="Why is the link single-use?">
          So a leaked or forwarded link cannot be replayed. The first time a private link is opened, it
          burns. Every later attempt gets the same &ldquo;no longer valid&rdquo; answer. Open it when
          you are ready to keep the file, and save it right away.
        </QA>
        <QA q="Do recipients need a wallet or an account?">
          For most safes, no. Email recipients just click the link and download. Some safes are
          addressed to a wallet instead, for extra protection, and those ask you to connect that wallet
          and sign once so your half of the key unwraps. The link tells you which kind it is.
        </QA>
      </Section>

      <Section title="Conditions">
        <QA q="What is a time-lock?">
          You pick a date and time. The key stays locked until then, enforced by drand, a public
          randomness beacon that publishes a value on a fixed schedule. No one can pull that value
          forward, us included. When the round arrives, the lock opens on its own. You can push the
          date out anytime before it, with one quick signature and no fee. If you never do, it releases
          automatically. That is the dead man&apos;s switch.
        </QA>
        <QA q="What is a trusted circle?">
          Instead of a clock, a group of people you name controls the release. You set how many must
          approve, say two of three. The safe stays sealed until that many of them actively approve. It
          never fires on its own. Use it when a human judgment call should decide whether the moment has
          come, not a calendar.
        </QA>
        <QA q="What is the difference between private and public?">
          Private means specific recipients, each with their own one-time link. Public means a single
          shareable link that anyone holding it can open after release. That choice is separate from
          what releases the safe, so you can mix and match: a public time-lock, a private trusted
          circle, and so on.
        </QA>
      </Section>

      <Section title="Managing a safe">
        <QA q="Can I change or cancel a safe after sealing it?">
          You can postpone a time-lock anytime before it releases, and you can delete a safe outright.
          You cannot edit the file or the recipients after sealing, because the encryption is bound to
          them at creation. If you need a change, delete it and create a new one.
        </QA>
        <QA q="Where is my file actually stored?">
          The ciphertext lives on Shelby, a decentralized storage network on Aptos. We only ever put
          encrypted bytes there. Your wallet pays the storage cost directly, so the file sits in your
          own namespace, not ours.
        </QA>
        <QA q="Is there a size or file-type limit?">
          Any file type works, and there is no fixed size limit. Very large files just take longer,
          since everything is encrypted in your browser before it is uploaded.
        </QA>
        <QA q="What does it cost?">
          You pay small network fees for storage and for on-chain actions like sealing, postponing, or
          approving. There is no subscription, and we never take custody of your file.
        </QA>
      </Section>

      <Section title="Trust and limits">
        <QA q="Can you, the operator, read my file?">
          No, and that is the whole point of the design. We never hold a usable key, and the plaintext
          never reaches us. If we were hacked, subpoenaed, or simply went rogue, there is nothing on
          our side to decrypt. The full list of what we can and cannot protect against is on the{" "}
          <Link href="/security">Security page</Link>.
        </QA>
        <QA q="What happens if Until Then goes away?">
          Your file is ciphertext on a decentralized network, and the unlock for a public time-lock is
          pure drand math that anyone can compute. The code is published and the retrieval pages are
          open, so the path to decrypt does not depend on our servers staying online.
        </QA>
        <QA q="How do I know the code has not been tampered with?">
          This is the one thing you trust alongside your own device: the code we serve you. We publish
          the source so you can read exactly what runs, and the bundles carry integrity hashes you can
          check against it. A browser crypto app can never rule this out completely, but we make it
          verifiable instead of asking you to take our word.
        </QA>
      </Section>

      <p className="text-sm">
        Still unsure about something? The <Link href="/security">Security page</Link> goes deeper on the
        threat model, in the same plain language.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 28 }}>
      <h2 className="h-2" style={{ marginBottom: 18 }}>{title}</h2>
      <div className="stack-24">{children}</div>
    </div>
  )
}

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="h-3" style={{ marginBottom: 7 }}>{q}</h3>
      <p className="text-body" style={{ margin: 0, color: "var(--text-2)" }}>{children}</p>
    </div>
  )
}
