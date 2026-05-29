// DeadDrop — screen components
// Depends on globals from components.jsx

const { useState, useEffect, useMemo, useRef } = React;

/* ============================================================
   LANDING
============================================================ */
function Landing({ onConnect, onSwitch }) {
  return (
    <div className="page page-wide" data-screen-label="01 Landing">
      <div style={{display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 64, alignItems: "center"}}
           className="landing-grid">
        <div className="stack-32">
          <Eyebrow>Conditional release · client-side encryption</Eyebrow>
          <h1 className="h-display">
            A safe<br/>that opens<br/><em>only when<br/>it should.</em>
          </h1>
          <p className="text-body" style={{maxWidth: 480}}>
            DeadDrop encrypts files on your device before they ever leave it,
            then holds the key behind a condition <em>you</em> set —
            a timer you keep alive, or a circle of people you trust.
          </p>
          <div className="row" style={{flexWrap: "wrap"}}>
            <button className="btn btn-primary btn-lg" onClick={onConnect}>
              Get started
              <Icon name="arrow-right" size={14} stroke={2}/>
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => onSwitch("recipient")}>
              I received a drop
            </button>
          </div>
          <div className="row" style={{gap: 12, flexWrap: "wrap"}}>
            <TrustBadge label="Encrypted on your device" />
            <TrustBadge label="We never see your files" />
          </div>
        </div>

        <div>
          <VaultIllustration />
        </div>
      </div>

      <hr className="hr" style={{margin: "96px 0 56px"}} />

      <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28}} className="three-col">
        <FeatureCard
          eyebrow="01 / Encrypt"
          title="Sealed on your device"
          body="Your files are encrypted in the browser before upload. The plaintext never touches a server — not ours, not anyone's."
          mono={"AES-256-GCM\nkey: held by you"}
        />
        <FeatureCard
          eyebrow="02 / Wait"
          title="A condition you control"
          body="Set a recurring timer you check in on, or pick a small group whose approval is required. The key stays sealed until the rule trips."
          mono={"if (silent_for >= 30d)\n  release(key)"}
        />
        <FeatureCard
          eyebrow="03 / Release"
          title="To exactly who you choose"
          body="When the condition is met, designated recipients get a one-time link. They decrypt locally. Nothing in the middle can read it."
          mono={"recipient.decrypt(\n  ciphertext, key)"}
        />
      </div>

      <style>{`
        @media (max-width: 880px) {
          .landing-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          .three-col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function VaultIllustration() {
  const ticks = Array.from({length: 60}, (_, i) => {
    const a = (i / 60) * 360;
    const long = i % 5 === 0;
    return (
      <span
        key={i}
        className="vault-tick"
        style={{
          transform: `translate(-50%, -50%) rotate(${a}deg) translate(0, -210px)`,
          height: long ? 8 : 4,
          background: long ? "var(--text-3)" : "var(--line-2)",
        }}
      />
    );
  });
  return (
    <div className="vault">
      <div className="vault-ring"></div>
      <div className="vault-ring r2"></div>
      <div className="vault-ring r3"></div>
      <div className="vault-core">SEALED</div>
      {ticks}
      <div style={{
        position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-4)",
        marginTop: 84, letterSpacing: "0.18em",
      }}>
        0xa3f1 · 9c2e · 7b8d
      </div>
    </div>
  );
}

function FeatureCard({ eyebrow, title, body, mono }) {
  return (
    <div className="card" style={{padding: 28, display: "flex", flexDirection: "column", gap: 18, minHeight: 280}}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h3 className="h-2" style={{fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 400}}>{title}</h3>
      <p className="text-sm" style={{flex: 1}}>{body}</p>
      <pre className="mono" style={{
        margin: 0, fontSize: 11, color: "var(--text-3)", whiteSpace: "pre-wrap",
        paddingTop: 16, borderTop: "1px solid var(--line-1)",
      }}>{mono}</pre>
    </div>
  );
}

/* ============================================================
   CONNECT WALLET MODAL
============================================================ */
function ConnectWalletModal({ open, onClose, onConnect }) {
  if (!open) return null;
  const wallets = [
    { id: "petra",    name: "Petra",    chain: "Aptos",    init: "P", color: "oklch(0.78 0.10 230)" },
    { id: "phantom",  name: "Phantom",  chain: "Solana",   init: "◈", color: "oklch(0.72 0.13 290)" },
    { id: "metamask", name: "MetaMask", chain: "Ethereum", init: "M", color: "oklch(0.78 0.12 70)" },
    { id: "wc",       name: "WalletConnect", chain: "Any EVM", init: "≋", color: "oklch(0.76 0.10 240)" },
  ];
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{marginBottom: 24}}>
          <div className="stack-4">
            <h2 className="h-2" style={{fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 400}}>Connect a wallet</h2>
            <div className="text-xs">Used only to sign — never to hold your data.</div>
          </div>
          <button className="btn btn-quiet" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="stack-8">
          {wallets.map(w => (
            <button key={w.id} className="wallet-row" onClick={() => onConnect(w)}>
              <div className="wallet-icon" style={{background: `color-mix(in oklch, ${w.color} 22%, var(--bg-3))`, color: w.color}}>
                {w.init}
              </div>
              <div className="stack-4" style={{flex: 1, textAlign: "left"}}>
                <div style={{fontSize: 14}}>{w.name}</div>
                <div className="text-xs">{w.chain}</div>
              </div>
              <Icon name="arrow-right" size={14}/>
            </button>
          ))}
        </div>

        <div className="text-xs" style={{marginTop: 20, padding: "12px 14px", background: "var(--bg-2)", borderRadius: "var(--r-md)", border: "1px solid var(--line-1)"}}>
          <div className="center" style={{gap: 8, marginBottom: 6, color: "var(--text-2)"}}>
            <Icon name="info" size={14}/> What does my wallet do here?
          </div>
          Your wallet signs a small message proving you own this account.
          It never authorizes payment or holds your files.
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   UPLOAD & ENCRYPT
============================================================ */
function UploadScreen({ onNext, draft, setDraft }) {
  const [file, setFile] = useState(draft.file);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | encrypting | uploading | done
  const [progress, setProgress] = useState(0);
  const [fingerprint, setFingerprint] = useState("");
  const fileRef = useRef(null);

  useEffect(() => { setDraft((d) => ({ ...d, file })); }, [file]);

  const onPick = (f) => {
    setFile(f);
    setPhase("idle");
    setProgress(0);
    setFingerprint("");
  };

  const startEncrypt = () => {
    setPhase("encrypting");
    setProgress(0);
    let p = 0;
    const i = setInterval(() => {
      p += Math.random() * 6 + 2;
      if (p >= 60) {
        clearInterval(i);
        setProgress(60);
        setFingerprint(makeFingerprint(file?.size || 1));
        setPhase("uploading");
        let q = 60;
        const j = setInterval(() => {
          q += Math.random() * 5 + 2;
          if (q >= 100) {
            clearInterval(j);
            setProgress(100);
            setPhase("done");
          } else setProgress(q);
        }, 140);
      } else setProgress(p);
    }, 120);
  };

  return (
    <div className="page page-narrow" data-screen-label="02 Upload">
      <Steps current={0} steps={["Encrypt file", "Set condition", "Add recipients", "Confirm"]} />
      <div style={{height: 32}}/>

      <div className="stack-12" style={{marginBottom: 28}}>
        <Eyebrow>Step 01 / Encrypt</Eyebrow>
        <h1 className="h-1">Pick something to seal.</h1>
        <p className="text-body" style={{maxWidth: 560}}>
          Drag any file in. We'll encrypt it in your browser before it goes anywhere.
          The key never leaves this tab.
        </p>
      </div>

      {!file && (
        <div
          className={`dropzone ${dragOver ? "active" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onPick({name: f.name, size: f.size, type: f.type});
          }}
        >
          <Icon name="upload" size={32} stroke={1.2}/>
          <div className="h-2" style={{marginTop: 14, fontWeight: 400}}>Drop a file or click to choose</div>
          <div className="text-xs" style={{marginTop: 6}}>Up to 100 MB · any file type</div>
          <input ref={fileRef} type="file" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick({name: f.name, size: f.size, type: f.type});
          }}/>
        </div>
      )}

      {file && (
        <div className="card" style={{padding: 24}}>
          <div className="between">
            <div className="center" style={{gap: 14}}>
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: "var(--bg-2)", border: "1px solid var(--line-1)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon name="file" size={20}/>
              </div>
              <div className="stack-4">
                <div style={{fontSize: 15}}>{file.name}</div>
                <div className="text-xs">
                  {(file.size / 1024).toFixed(file.size > 1024 * 1024 ? 0 : 1)}
                  {file.size > 1024 * 1024 ? ` MB` : ` KB`}
                  {" · "}
                  {file.type || "binary"}
                </div>
              </div>
            </div>
            {phase === "idle" && (
              <button className="btn btn-quiet" onClick={() => setFile(null)}>
                <Icon name="x" size={14}/> Change
              </button>
            )}
          </div>

          {phase !== "idle" && (
            <>
              <hr className="hr"/>
              <div className="stack-12">
                <div className="between">
                  <div className="center" style={{gap: 10}}>
                    {phase === "done" ? (
                      <span style={{color: "var(--green)"}}><Icon name="check" size={16} stroke={2}/></span>
                    ) : (
                      <Icon name="lock" size={16}/>
                    )}
                    <span className="text-sm" style={{color: "var(--text-1)"}}>
                      {phase === "encrypting" && "Encrypting locally…"}
                      {phase === "uploading" && "Uploading sealed blob…"}
                      {phase === "done" && "Sealed."}
                    </span>
                  </div>
                  <span className="mono text-xs">{Math.round(progress)}%</span>
                </div>
                <div className={`progress ${phase === "done" ? "" : "amber"}`}>
                  <div className="progress-bar" style={{width: `${progress}%`}}></div>
                </div>
                {fingerprint && (
                  <div style={{marginTop: 8}}>
                    <div className="text-xs" style={{marginBottom: 6}}>Ciphertext fingerprint</div>
                    <div className="fingerprint">{fingerprint}</div>
                  </div>
                )}
              </div>
            </>
          )}

          <hr className="hr"/>

          <div className="between" style={{flexWrap: "wrap", gap: 12}}>
            <TrustBadge label="Encrypted on this device · AES-256-GCM" />
            <div className="row">
              {phase === "idle" && (
                <button className="btn btn-primary" onClick={startEncrypt}>
                  Encrypt &amp; continue
                  <Icon name="arrow-right" size={14} stroke={2}/>
                </button>
              )}
              {phase === "done" && (
                <button className="btn btn-primary" onClick={onNext}>
                  Set release condition
                  <Icon name="arrow-right" size={14} stroke={2}/>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs" style={{marginTop: 24, maxWidth: 560}}>
        <Icon name="info" size={12} style={{verticalAlign: "-2px", marginRight: 4}}/>
        The encryption key is split: half stays in your wallet's signature, half is held by the release rule.
        Even if our servers were compromised, no one can read your file.
      </p>
    </div>
  );
}

/* ============================================================
   CONDITION SETUP
============================================================ */
function ConditionScreen({ onNext, onBack, draft, setDraft }) {
  const [mode, setMode] = useState(draft.mode || "timelock");
  const [hours, setHours] = useState(draft.checkIn || 30 * 24); // hours
  const [graceDays, setGraceDays] = useState(draft.grace || 7);

  // multisig
  const [signers, setSigners] = useState(draft.signers || [
    { name: "Sarah (lawyer)", addr: "0x7f3a2c81b9d4e5f6a7c8b9d0e1f2a3b4c5d6e7f8" },
    { name: "", addr: "" },
    { name: "", addr: "" },
  ]);
  const [threshold, setThreshold] = useState(draft.threshold || 2);

  useEffect(() => {
    setDraft((d) => ({...d, mode, checkIn: hours, grace: graceDays, signers, threshold}));
  }, [mode, hours, graceDays, signers, threshold]);

  const days = Math.round(hours / 24);
  const validSigners = signers.filter(s => s.addr.length > 8).length;

  return (
    <div className="page page-narrow" data-screen-label="03 Condition">
      <Steps current={1} steps={["Encrypt file", "Set condition", "Add recipients", "Confirm"]} />
      <div style={{height: 32}}/>

      <div className="stack-12" style={{marginBottom: 28}}>
        <Eyebrow>Step 02 / Condition</Eyebrow>
        <h1 className="h-1">When should the safe open?</h1>
        <p className="text-body" style={{maxWidth: 560}}>
          Choose how the key gets released. You can change this later, but only by signing from the same wallet.
        </p>
      </div>

      <div className="toggle-group" style={{marginBottom: 32}}>
        <button className={`toggle-card ${mode === "timelock" ? "active" : ""}`} onClick={() => setMode("timelock")}>
          <div className="between">
            <Icon name="clock" size={20}/>
            <span className="check"></span>
          </div>
          <div className="stack-4">
            <div className="h-2" style={{fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 400}}>Time-lock</div>
            <div className="text-sm">
              A check-in timer. If you don't reset it within the interval, the safe opens.
            </div>
          </div>
          <div className="text-xs muted">Best for: estate planning, sensitive archives</div>
        </button>
        <button className={`toggle-card ${mode === "multisig" ? "active" : ""}`} onClick={() => setMode("multisig")}>
          <div className="between">
            <Icon name="users" size={20}/>
            <span className="check"></span>
          </div>
          <div className="stack-4">
            <div className="h-2" style={{fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 400}}>Trusted circle</div>
            <div className="text-sm">
              A small group of people. The safe opens when enough of them agree.
            </div>
          </div>
          <div className="text-xs muted">Best for: journalists, whistleblowers, business continuity</div>
        </button>
      </div>

      {/* TIMELOCK CONFIG */}
      {mode === "timelock" && (
        <div className="card" style={{padding: 28}}>
          <h3 className="h-3" style={{marginBottom: 20}}>Check-in interval</h3>

          <div className="stack-12">
            <div className="between">
              <span className="text-sm">Reset every</span>
              <span style={{fontFamily: "var(--font-serif)", fontSize: 32, color: "var(--text-1)"}}>
                {days} <span style={{fontSize: 16, color: "var(--text-3)"}}>days</span>
              </span>
            </div>
            <input
              type="range" min={24} max={365 * 24} step={24}
              value={hours} onChange={(e) => setHours(+e.target.value)}
            />
            <div className="between text-xs muted">
              <span>1 day</span><span>1 year</span>
            </div>
          </div>

          <hr className="hr"/>

          <div className="stack-12">
            <div className="between">
              <span className="text-sm">Grace period before trigger</span>
              <span className="mono" style={{color: "var(--text-1)"}}>{graceDays} day{graceDays !== 1 ? "s" : ""}</span>
            </div>
            <input
              type="range" min={1} max={30} step={1}
              value={graceDays} onChange={(e) => setGraceDays(+e.target.value)}
            />
            <p className="text-xs">
              If you miss your check-in, we'll email and message you for {graceDays} day{graceDays !== 1 ? "s" : ""} before the safe opens.
            </p>
          </div>

          <div className="card" style={{
            padding: 18, marginTop: 24, background: "var(--bg-2)",
            border: "1px dashed var(--line-2)",
          }}>
            <div className="text-xs muted" style={{marginBottom: 8}}>In plain words</div>
            <p className="text-body" style={{margin: 0, color: "var(--text-1)", fontSize: 14}}>
              Every <strong>{days} days</strong>, you'll sign a quick "I'm still here" message.
              {" "}If you go silent for more than {days + graceDays} days total,
              the key is released to your recipients automatically.
            </p>
          </div>
        </div>
      )}

      {/* MULTISIG CONFIG */}
      {mode === "multisig" && (
        <div className="card" style={{padding: 28}}>
          <h3 className="h-3" style={{marginBottom: 6}}>Trusted signers</h3>
          <p className="text-xs" style={{marginBottom: 20}}>Add up to 5 wallet addresses. Anyone you trust to make the call.</p>

          <div className="stack-12">
            {signers.map((s, i) => (
              <div key={i} className="row" style={{alignItems: "center", gap: 10}}>
                <div style={{
                  width: 28, height: 28, borderRadius: "100px", flexShrink: 0,
                  border: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)",
                }}>{i + 1}</div>
                <input
                  className="input"
                  placeholder="Name or label (optional)"
                  value={s.name}
                  style={{flex: "1 1 30%", minWidth: 140}}
                  onChange={(e) => {
                    const copy = [...signers]; copy[i] = {...copy[i], name: e.target.value}; setSigners(copy);
                  }}
                />
                <input
                  className="input mono"
                  placeholder="0x… wallet address"
                  value={s.addr}
                  style={{flex: "2 1 60%", minWidth: 200}}
                  onChange={(e) => {
                    const copy = [...signers]; copy[i] = {...copy[i], addr: e.target.value}; setSigners(copy);
                  }}
                />
                {signers.length > 2 && (
                  <button className="btn btn-quiet" onClick={() => {
                    const copy = signers.filter((_, j) => j !== i); setSigners(copy);
                    if (threshold > copy.length) setThreshold(copy.length);
                  }}>
                    <Icon name="trash" size={14}/>
                  </button>
                )}
              </div>
            ))}
            {signers.length < 5 && (
              <button className="btn btn-ghost btn-sm" style={{alignSelf: "flex-start"}}
                      onClick={() => setSigners([...signers, {name: "", addr: ""}])}>
                <Icon name="plus" size={14}/> Add signer
              </button>
            )}
          </div>

          <hr className="hr"/>

          <div className="stack-12">
            <div className="between">
              <span className="text-sm">Required approvals</span>
              <span style={{fontFamily: "var(--font-serif)", fontSize: 28, color: "var(--text-1)"}}>
                {threshold} <span style={{fontSize: 14, color: "var(--text-3)"}}>of {signers.length}</span>
              </span>
            </div>
            <input
              type="range" min={1} max={Math.max(1, signers.length)} step={1}
              value={threshold} onChange={(e) => setThreshold(+e.target.value)}
            />
          </div>

          <div className="card" style={{
            padding: 18, marginTop: 24, background: "var(--bg-2)",
            border: "1px dashed var(--line-2)",
          }}>
            <div className="text-xs muted" style={{marginBottom: 8}}>In plain words</div>
            <p className="text-body" style={{margin: 0, color: "var(--text-1)", fontSize: 14}}>
              The safe stays sealed until any <strong>{threshold} of {signers.length}</strong> trusted signers
              approve the release. They each sign a message from their own wallet — no one person can act alone.
            </p>
          </div>
        </div>
      )}

      <div className="between" style={{marginTop: 32}}>
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrow-left" size={14} stroke={2}/> Back
        </button>
        <button
          className="btn btn-primary"
          disabled={mode === "multisig" && validSigners < threshold}
          onClick={onNext}
        >
          Continue
          <Icon name="arrow-right" size={14} stroke={2}/>
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   RECIPIENTS + CONFIRM (one screen, two sections)
============================================================ */
function ConfirmScreen({ onBack, onSubmit, draft, setDraft }) {
  const [recipients, setRecipients] = useState(draft.recipients || [
    { name: "", contact: "" },
  ]);
  const [title, setTitle] = useState(draft.title || "");

  useEffect(() => {
    setDraft((d) => ({...d, recipients, title}));
  }, [recipients, title]);

  const valid = title.trim() && recipients.some(r => r.contact.trim());

  return (
    <div className="page page-narrow" data-screen-label="04 Confirm">
      <Steps current={2} steps={["Encrypt file", "Set condition", "Add recipients", "Confirm"]} />
      <div style={{height: 32}}/>

      <div className="stack-12" style={{marginBottom: 28}}>
        <Eyebrow>Step 03 / Recipients & details</Eyebrow>
        <h1 className="h-1">Who should get this if it opens?</h1>
        <p className="text-body">
          They'll receive a one-time link by email or messaging when the condition is met.
        </p>
      </div>

      <div className="card" style={{padding: 28, marginBottom: 24}}>
        <div className="field" style={{marginBottom: 20}}>
          <label className="field-label">Drop name (only you see this)</label>
          <input
            className="input"
            placeholder="e.g. Legal docs for family"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <hr className="hr"/>

        <h3 className="h-3" style={{marginBottom: 14}}>Recipients</h3>
        <div className="stack-12">
          {recipients.map((r, i) => (
            <div key={i} className="row" style={{alignItems: "center"}}>
              <input
                className="input"
                placeholder="Name (optional)"
                value={r.name}
                style={{flex: "1 1 30%", minWidth: 120}}
                onChange={(e) => {
                  const c = [...recipients]; c[i] = {...c[i], name: e.target.value}; setRecipients(c);
                }}
              />
              <input
                className="input"
                placeholder="email@example.com or @username"
                value={r.contact}
                style={{flex: "2 1 60%"}}
                onChange={(e) => {
                  const c = [...recipients]; c[i] = {...c[i], contact: e.target.value}; setRecipients(c);
                }}
              />
              {recipients.length > 1 && (
                <button className="btn btn-quiet" onClick={() => {
                  setRecipients(recipients.filter((_, j) => j !== i));
                }}>
                  <Icon name="trash" size={14}/>
                </button>
              )}
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{alignSelf: "flex-start"}}
                  onClick={() => setRecipients([...recipients, {name: "", contact: ""}])}>
            <Icon name="plus" size={14}/> Add recipient
          </button>
        </div>
      </div>

      {/* Summary card */}
      <div className="card" style={{padding: 28, marginBottom: 32}}>
        <Eyebrow>Review</Eyebrow>
        <div className="stack-16" style={{marginTop: 16}}>
          <SummaryRow label="File" value={draft.file?.name || "—"}/>
          <SummaryRow label="Encryption" value="AES-256-GCM · client-side"/>
          <SummaryRow
            label="Release rule"
            value={
              draft.mode === "timelock"
                ? `Time-lock · every ${Math.round((draft.checkIn || 720) / 24)} days, ${draft.grace || 7}-day grace`
                : `${draft.threshold || 2} of ${draft.signers?.length || 3} signers`
            }
          />
          <SummaryRow label="Recipients" value={`${recipients.filter(r => r.contact).length || 0} configured`}/>
        </div>
      </div>

      <div className="between" style={{flexWrap: "wrap", gap: 12}}>
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrow-left" size={14} stroke={2}/> Back
        </button>
        <button
          className="btn btn-primary btn-lg"
          disabled={!valid}
          onClick={onSubmit}
        >
          <Icon name="lock" size={14}/> Arm drop
        </button>
      </div>

      <p className="text-xs muted" style={{marginTop: 18, textAlign: "right"}}>
        Arming asks for one signature from your wallet.
      </p>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="between" style={{borderBottom: "1px solid var(--line-1)", paddingBottom: 14}}>
      <span className="text-xs" style={{textTransform: "uppercase", letterSpacing: "0.1em"}}>{label}</span>
      <span style={{fontSize: 14, color: "var(--text-1)", textAlign: "right"}}>{value}</span>
    </div>
  );
}

/* ============================================================
   DASHBOARD
============================================================ */
function Dashboard({ drops, onCreate, onOpen, onReset }) {
  const armed = drops.filter(d => d.status === "armed").length;
  const triggered = drops.filter(d => d.status === "triggered").length;

  return (
    <div className="page" data-screen-label="05 Dashboard">
      <div className="between" style={{flexWrap: "wrap", gap: 18, marginBottom: 32}}>
        <div className="stack-8">
          <Eyebrow>Your safes</Eyebrow>
          <h1 className="h-1">Dashboard</h1>
        </div>
        <button className="btn btn-primary" onClick={onCreate}>
          <Icon name="plus" size={14} stroke={2}/> New drop
        </button>
      </div>

      <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32}}
           className="stat-grid">
        <StatCard label="Active" value={armed} tone="amber"/>
        <StatCard label="Triggered" value={triggered} tone={triggered ? "red" : "default"}/>
        <StatCard label="Total drops" value={drops.length}/>
      </div>

      <div className="card" style={{overflow: "hidden"}}>
        <div className="between" style={{padding: "16px 22px", borderBottom: "1px solid var(--line-1)"}}>
          <h3 className="h-3">All drops</h3>
          <div className="text-xs">{drops.length} item{drops.length !== 1 ? "s" : ""}</div>
        </div>
        {drops.length === 0 && (
          <div style={{padding: 56, textAlign: "center"}}>
            <Icon name="lock" size={28} stroke={1.2}/>
            <div className="h-2" style={{marginTop: 14, fontWeight: 400}}>Nothing sealed yet</div>
            <p className="text-sm" style={{marginTop: 6}}>Encrypt your first file to get started.</p>
            <button className="btn btn-primary" style={{marginTop: 18}} onClick={onCreate}>
              <Icon name="plus" size={14} stroke={2}/> New drop
            </button>
          </div>
        )}
        {drops.map(d => <DropRow key={d.id} drop={d} onOpen={() => onOpen(d.id)} onReset={() => onReset(d.id)}/>)}
      </div>

      <style>{`
        @media (max-width: 720px) { .stat-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const color = tone === "amber" ? "var(--amber)" : tone === "red" ? "var(--red)" : "var(--text-1)";
  return (
    <div className="card" style={{padding: 22}}>
      <div className="text-xs" style={{textTransform: "uppercase", letterSpacing: "0.12em"}}>{label}</div>
      <div style={{fontFamily: "var(--font-serif)", fontSize: 48, lineHeight: 1.1, marginTop: 8, color}}>{value}</div>
    </div>
  );
}

function DropRow({ drop, onOpen, onReset }) {
  // Compute remaining time
  const remaining = drop.triggerAt ? Math.max(0, drop.triggerAt - Date.now()) : 0;
  const isLow = drop.status === "armed" && remaining < 1000 * 60 * 60 * 24 * 2;

  return (
    <div className="drop-row">
      <div>
        <div className="center" style={{gap: 12, marginBottom: 6}}>
          <span style={{fontSize: 15}}>{drop.title}</span>
          {drop.status === "armed" && <Chip tone="armed">Armed</Chip>}
          {drop.status === "triggered" && <Chip tone="triggered">Triggered</Chip>}
          {drop.status === "expired" && <Chip tone="expired">Expired</Chip>}
        </div>
        <div className="text-xs">
          <span className="mono">{drop.file}</span>
          {" · "}
          {drop.mode === "timelock"
            ? `Time-lock · every ${drop.checkInDays}d`
            : `${drop.threshold}-of-${drop.signers} signers`}
          {" · "}
          {drop.recipients} recipient{drop.recipients !== 1 ? "s" : ""}
        </div>
      </div>

      <div style={{textAlign: "right"}}>
        {drop.status === "armed" && drop.mode === "timelock" && (
          <>
            <div className="text-xs" style={{marginBottom: 4, color: isLow ? "var(--red)" : "var(--text-3)"}}>
              Releases in
            </div>
            <Countdown ms={remaining} tone={isLow ? "triggered" : "armed"}/>
          </>
        )}
        {drop.status === "armed" && drop.mode === "multisig" && (
          <>
            <div className="text-xs" style={{marginBottom: 4}}>Approvals</div>
            <span className="mono" style={{color: "var(--amber)", fontSize: 15}}>
              {drop.approvals || 0} / {drop.threshold}
            </span>
          </>
        )}
        {drop.status === "triggered" && (
          <>
            <div className="text-xs" style={{marginBottom: 4, color: "var(--red)"}}>Released</div>
            <span className="mono" style={{fontSize: 13}}>2h ago</span>
          </>
        )}
      </div>

      <div className="row" style={{gap: 8}}>
        {drop.status === "armed" && drop.mode === "timelock" && (
          <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onReset(); }}>
            <Icon name="refresh" size={12} stroke={2}/> Reset timer
          </button>
        )}
        <button className="btn btn-quiet btn-sm" onClick={onOpen}>
          Open <Icon name="arrow-right" size={12} stroke={2}/>
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   DROP DETAIL
============================================================ */
function DropDetail({ drop, onBack, onReset }) {
  if (!drop) return null;
  const remaining = drop.triggerAt ? Math.max(0, drop.triggerAt - Date.now()) : 0;
  const isLow = drop.status === "armed" && remaining < 1000 * 60 * 60 * 24 * 2;

  return (
    <div className="page page-narrow" data-screen-label="06 Drop detail">
      <button className="btn btn-quiet" onClick={onBack} style={{marginBottom: 24, marginLeft: -12}}>
        <Icon name="arrow-left" size={14} stroke={2}/> All drops
      </button>

      <div className="between" style={{marginBottom: 32, flexWrap: "wrap", gap: 12}}>
        <div className="stack-8">
          <Eyebrow>Drop</Eyebrow>
          <h1 className="h-1">{drop.title}</h1>
          <div className="center" style={{gap: 10, marginTop: 6}}>
            {drop.status === "armed" && <Chip tone="armed">Armed</Chip>}
            {drop.status === "triggered" && <Chip tone="triggered">Triggered</Chip>}
            <span className="text-xs mono">{drop.id}</span>
          </div>
        </div>
      </div>

      {/* Countdown card */}
      {drop.status === "armed" && drop.mode === "timelock" && (
        <div className="card" style={{padding: 32, marginBottom: 24, position: "relative", overflow: "hidden"}}>
          <Eyebrow>{isLow ? "Check in soon" : "Time until release"}</Eyebrow>
          <div style={{marginTop: 16}}>
            <Countdown ms={remaining} big tone={isLow ? "triggered" : "armed"}/>
          </div>
          <div className="text-sm" style={{marginTop: 16, maxWidth: 520}}>
            If you don't reset by then, the key is automatically released to your recipients.
            Resetting takes one signature.
          </div>
          <div style={{marginTop: 24}}>
            <button className="btn btn-primary" onClick={onReset}>
              <Icon name="refresh" size={14} stroke={2}/> I'm still here · reset timer
            </button>
          </div>
        </div>
      )}

      {drop.status === "armed" && drop.mode === "multisig" && (
        <div className="card" style={{padding: 32, marginBottom: 24}}>
          <Eyebrow>Approvals</Eyebrow>
          <div className="between" style={{marginTop: 12, marginBottom: 16}}>
            <div style={{fontFamily: "var(--font-serif)", fontSize: 48, color: "var(--amber)"}}>
              {drop.approvals || 0} <span style={{color: "var(--text-3)", fontSize: 24}}>of {drop.threshold}</span>
            </div>
            <button className="btn btn-ghost">Cancel drop</button>
          </div>
          <div className="text-sm" style={{maxWidth: 520}}>
            The safe opens when {drop.threshold} of {drop.signers} trusted signers approve release.
            You can revoke any time before that.
          </div>
        </div>
      )}

      {drop.status === "triggered" && (
        <div className="card" style={{padding: 32, marginBottom: 24, borderColor: "color-mix(in oklch, var(--red) 35%, var(--line-1))"}}>
          <div className="urgent-banner" style={{marginBottom: 20}}>
            <span className="pulse"></span>
            <span>This drop has been released. Recipients have been notified.</span>
          </div>
          <Eyebrow>Released at</Eyebrow>
          <div style={{fontFamily: "var(--font-serif)", fontSize: 32, marginTop: 8}}>
            May 25, 2026 · 14:22 UTC
          </div>
          <div className="text-sm" style={{marginTop: 12}}>
            The key is now visible to your designated recipients. The file remains encrypted
            on storage but the decryption key has been released.
          </div>
        </div>
      )}

      {/* Details grid */}
      <div className="card" style={{padding: 28}}>
        <h3 className="h-3" style={{marginBottom: 18}}>Details</h3>
        <div className="stack-16">
          <SummaryRow label="File" value={drop.file}/>
          <SummaryRow label="Size" value={drop.size || "—"}/>
          <SummaryRow label="Created" value={drop.created || "Mar 14, 2026"}/>
          <SummaryRow label="Encryption" value="AES-256-GCM · client-side"/>
          <SummaryRow
            label="Release rule"
            value={drop.mode === "timelock"
              ? `Reset every ${drop.checkInDays} days`
              : `${drop.threshold} of ${drop.signers} signers`}
          />
          <SummaryRow label="Recipients" value={`${drop.recipients} configured`}/>
        </div>

        <hr className="hr"/>

        <div className="text-xs" style={{marginBottom: 8}}>Ciphertext fingerprint</div>
        <div className="fingerprint">{makeFingerprint(drop.id.length)}</div>
      </div>
    </div>
  );
}

/* ============================================================
   RECIPIENT RETRIEVAL
============================================================ */
function RecipientScreen({ onSwitch }) {
  const [phase, setPhase] = useState("locked"); // locked | unlocking | done
  const [progress, setProgress] = useState(0);

  const startUnlock = () => {
    setPhase("unlocking");
    setProgress(0);
    let p = 0;
    const i = setInterval(() => {
      p += Math.random() * 8 + 3;
      if (p >= 100) {
        clearInterval(i);
        setProgress(100);
        setPhase("done");
      } else setProgress(p);
    }, 130);
  };

  return (
    <div className="page page-narrow" data-screen-label="07 Recipient">
      <div className="urgent-banner" style={{marginBottom: 28}}>
        <span className="pulse"></span>
        <span>A DeadDrop addressed to you has been released.</span>
      </div>

      <div className="stack-12" style={{marginBottom: 32}}>
        <Eyebrow>Incoming · From Sarah Chen</Eyebrow>
        <h1 className="h-1">A message has been left for you.</h1>
        <p className="text-body">
          Sarah Chen set this aside for you and instructed that it be released
          if she didn't check in by <span className="mono" style={{color: "var(--text-1)"}}>May 25, 2026</span>.
          That moment has now passed.
        </p>
      </div>

      <div className="card" style={{padding: 28, marginBottom: 24}}>
        <div className="row" style={{gap: 18, alignItems: "flex-start"}}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            background: "var(--bg-2)", border: "1px solid var(--line-1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="file" size={26} stroke={1.2}/>
          </div>
          <div className="stack-4" style={{flex: 1}}>
            <div style={{fontSize: 17}}>legal-documents.zip</div>
            <div className="text-xs">
              4.2 MB · application/zip · encrypted with AES-256-GCM
            </div>
            <div className="text-xs mono" style={{marginTop: 8, color: "var(--text-4)"}}>
              SHA-256 · 3f2a9c81 b9d4e5f6 a7c8b9d0 e1f2a3b4
            </div>
          </div>
        </div>

        <hr className="hr"/>

        <div className="stack-12">
          <div className="text-xs">Message from Sarah</div>
          <p className="text-body" style={{margin: 0, fontStyle: "italic",
              paddingLeft: 14, borderLeft: "2px solid var(--line-2)", color: "var(--text-2)"}}>
            "If you're reading this, things didn't go as planned. Everything you need
            to handle the estate is in this archive. The lawyer's name and number
            are in the README. Take care of yourself."
          </p>
        </div>

        <hr className="hr"/>

        {phase === "locked" && (
          <>
            <div className="stack-12" style={{marginBottom: 20}}>
              <div className="center" style={{gap: 10}}>
                <Icon name="info" size={14}/>
                <span className="text-sm">Before you continue</span>
              </div>
              <ul className="text-sm" style={{margin: 0, paddingLeft: 18, color: "var(--text-2)"}}>
                <li>The decryption happens entirely in your browser — your copy never leaves this device.</li>
                <li>You don't need a wallet or an account to retrieve this.</li>
                <li>The link is single-use. Save the file once you've downloaded it.</li>
              </ul>
            </div>
            <button className="btn btn-primary btn-lg" onClick={startUnlock} style={{width: "100%"}}>
              <Icon name="key" size={14}/> Decrypt &amp; download
            </button>
          </>
        )}

        {phase === "unlocking" && (
          <div className="stack-12">
            <div className="between">
              <div className="center" style={{gap: 10}}>
                <Icon name="key" size={14}/>
                <span className="text-sm" style={{color: "var(--text-1)"}}>Decrypting on your device…</span>
              </div>
              <span className="mono text-xs">{Math.round(progress)}%</span>
            </div>
            <div className="progress amber">
              <div className="progress-bar" style={{width: `${progress}%`}}></div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="stack-16">
            <div className="center" style={{gap: 10, color: "var(--green)"}}>
              <Icon name="check" size={18} stroke={2}/>
              <span style={{fontSize: 15}}>Decrypted successfully.</span>
            </div>
            <button className="btn btn-primary btn-lg" style={{width: "100%"}}>
              <Icon name="download" size={14}/> Download legal-documents.zip
            </button>
            <p className="text-xs">
              This page won't show the file again after you leave. Make sure you save it.
            </p>
          </div>
        )}
      </div>

      <div className="text-xs muted" style={{textAlign: "center", marginTop: 32}}>
        <button className="btn btn-quiet btn-sm" onClick={() => onSwitch("landing")} style={{padding: 0}}>
          What is DeadDrop? <Icon name="arrow-right" size={12}/>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  Landing, ConnectWalletModal, UploadScreen, ConditionScreen,
  ConfirmScreen, Dashboard, DropDetail, RecipientScreen,
});
