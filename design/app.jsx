// DeadDrop — main app shell, navigation, sample state

const { useState: useStateApp, useEffect: useEffectApp, useMemo: useMemoApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "amber",
  "showRecipientByDefault": false,
  "typeface": "geist-instrument"
}/*EDITMODE-END*/;

const ACCENT_PALETTES = {
  amber:  { amber: "oklch(0.82 0.13 75)",  amberDim: "oklch(0.55 0.10 75)",  amberSoft: "oklch(0.30 0.06 75)" },
  ember:  { amber: "oklch(0.72 0.18 35)",  amberDim: "oklch(0.50 0.13 35)",  amberSoft: "oklch(0.28 0.08 35)" },
  iris:   { amber: "oklch(0.78 0.12 280)", amberDim: "oklch(0.55 0.10 280)", amberSoft: "oklch(0.30 0.06 280)" },
  jade:   { amber: "oklch(0.80 0.11 155)", amberDim: "oklch(0.55 0.09 155)", amberSoft: "oklch(0.28 0.06 155)" },
};

const TYPE_PRESETS = {
  "geist-instrument": {
    importUrl: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap",
    sans: '"Geist", ui-sans-serif, system-ui, sans-serif',
    serif: '"Instrument Serif", Georgia, serif',
    mono: '"Geist Mono", ui-monospace, monospace',
  },
  "switzer-fraunces": {
    importUrl: "https://fonts.googleapis.com/css2?family=Switzer:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Spectral:ital,wght@0,400;1,400&display=swap",
    sans: '"Switzer", ui-sans-serif, system-ui, sans-serif',
    serif: '"Spectral", Georgia, serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
};

// ---- Sample data --------------------------------------------------
const now = Date.now();
const DAY = 1000 * 60 * 60 * 24;
const SAMPLE_DROPS = [
  {
    id: "drop_8f3a2c81",
    title: "Source documents · Project Mistral",
    file: "mistral-source.pdf.enc",
    size: "12.4 MB",
    mode: "multisig",
    signers: 3,
    threshold: 2,
    approvals: 0,
    recipients: 1,
    status: "armed",
    created: "Apr 02, 2026",
  },
  {
    id: "drop_b9d4e5f6",
    title: "Estate · Vault contents",
    file: "estate.zip.enc",
    size: "84.1 MB",
    mode: "timelock",
    checkInDays: 30,
    recipients: 3,
    status: "armed",
    triggerAt: now + DAY * 12 + 1000 * 60 * 60 * 4 + 1000 * 60 * 17,
    created: "Mar 14, 2026",
  },
  {
    id: "drop_7c8b9d0e",
    title: "Press kit · embargo backup",
    file: "embargo.tar.enc",
    size: "3.1 MB",
    mode: "timelock",
    checkInDays: 7,
    recipients: 2,
    status: "armed",
    triggerAt: now + 1000 * 60 * 60 * 38, // < 2 days = low
    created: "May 21, 2026",
  },
  {
    id: "drop_1f2a3b4c",
    title: "Notes for Maya",
    file: "notes.txt.enc",
    size: "12 KB",
    mode: "timelock",
    checkInDays: 90,
    recipients: 1,
    status: "triggered",
    created: "Jan 08, 2026",
  },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Screen routing
  const [screen, setScreen] = useStateApp(t.showRecipientByDefault ? "recipient" : "landing");
  const [openDropId, setOpenDropId] = useStateApp(null);

  // Wallet state
  const [wallet, setWallet] = useStateApp(null);
  const [connectOpen, setConnectOpen] = useStateApp(false);

  // Drops
  const [drops, setDrops] = useStateApp(SAMPLE_DROPS);

  // Create flow state
  const [draft, setDraft] = useStateApp({});

  // Apply accent palette
  useEffectApp(() => {
    const p = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.amber;
    document.documentElement.style.setProperty("--amber", p.amber);
    document.documentElement.style.setProperty("--amber-dim", p.amberDim);
    document.documentElement.style.setProperty("--amber-soft", p.amberSoft);
  }, [t.accent]);

  // Apply type preset
  useEffectApp(() => {
    const preset = TYPE_PRESETS[t.typeface] || TYPE_PRESETS["geist-instrument"];
    // Ensure stylesheet is loaded
    const id = "type-preset-link";
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = preset.importUrl;
    document.documentElement.style.setProperty("--font-sans", preset.sans);
    document.documentElement.style.setProperty("--font-serif", preset.serif);
    document.documentElement.style.setProperty("--font-mono", preset.mono);
  }, [t.typeface]);

  // Tick countdown
  const [, setTick] = useStateApp(0);
  useEffectApp(() => {
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);

  // Handlers
  const handleConnect = (w) => {
    setWallet({
      ...w,
      address: "0x" + Array.from({length: 40}, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
    });
    setConnectOpen(false);
    setScreen("dashboard");
  };

  const startCreate = () => {
    setDraft({});
    setScreen("upload");
  };

  const submitDrop = () => {
    const id = "drop_" + Math.random().toString(16).slice(2, 10);
    const checkInDays = Math.round((draft.checkIn || 720) / 24);
    const newDrop = {
      id,
      title: draft.title || "Untitled drop",
      file: (draft.file?.name || "file") + ".enc",
      size: draft.file ? `${(draft.file.size / (1024 * 1024)).toFixed(1)} MB` : "—",
      mode: draft.mode || "timelock",
      checkInDays,
      signers: draft.signers?.length || 3,
      threshold: draft.threshold || 2,
      approvals: 0,
      recipients: (draft.recipients || []).filter(r => r.contact).length,
      status: "armed",
      triggerAt: (draft.mode || "timelock") === "timelock" ? Date.now() + DAY * checkInDays : null,
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
    };
    setDrops((d) => [newDrop, ...d]);
    setOpenDropId(id);
    setScreen("drop");
  };

  const handleReset = (id) => {
    setDrops((ds) => ds.map(d => d.id === id
      ? { ...d, triggerAt: Date.now() + DAY * (d.checkInDays || 30) }
      : d));
  };

  const goto = (screenName) => {
    setScreen(screenName);
  };

  const isAuthed = !!wallet;
  const openDrop = drops.find(d => d.id === openDropId);

  return (
    <div className="app-shell">
      <Topbar
        wallet={wallet}
        screen={screen}
        isAuthed={isAuthed}
        onBrand={() => setScreen(isAuthed ? "dashboard" : "landing")}
        onConnect={() => setConnectOpen(true)}
        onDisconnect={() => { setWallet(null); setScreen("landing"); }}
        onNav={goto}
      />

      <main>
        {screen === "landing"   && <Landing onConnect={() => setConnectOpen(true)} onSwitch={goto}/>}
        {screen === "upload"    && <UploadScreen draft={draft} setDraft={setDraft} onNext={() => setScreen("condition")}/>}
        {screen === "condition" && <ConditionScreen draft={draft} setDraft={setDraft}
                                                    onBack={() => setScreen("upload")} onNext={() => setScreen("confirm")}/>}
        {screen === "confirm"   && <ConfirmScreen draft={draft} setDraft={setDraft}
                                                  onBack={() => setScreen("condition")} onSubmit={submitDrop}/>}
        {screen === "dashboard" && <Dashboard drops={drops}
                                              onCreate={startCreate}
                                              onOpen={(id) => { setOpenDropId(id); setScreen("drop"); }}
                                              onReset={handleReset}/>}
        {screen === "drop"      && <DropDetail drop={openDrop}
                                               onBack={() => setScreen("dashboard")}
                                               onReset={() => handleReset(openDrop.id)}/>}
        {screen === "recipient" && <RecipientScreen onSwitch={goto}/>}
      </main>

      <Footer/>

      <ConnectWalletModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnect={handleConnect}
      />

      <Tweaks t={t} setTweak={setTweak} setScreen={setScreen}/>
    </div>
  );
}

function Topbar({ wallet, screen, isAuthed, onBrand, onConnect, onDisconnect, onNav }) {
  return (
    <header className="topbar">
      <div className="brand" onClick={onBrand}>
        <div className="brand-mark"></div>
        <div className="brand-name">DeadDrop</div>
      </div>

      <div className="topbar-spacer"></div>

      {isAuthed && (
        <nav className="topbar-nav">
          <button className={screen === "dashboard" ? "active" : ""} onClick={() => onNav("dashboard")}>Dashboard</button>
          <button className={["upload", "condition", "confirm"].includes(screen) ? "active" : ""} onClick={() => onNav("upload")}>New drop</button>
          <button onClick={() => onNav("recipient")}>Recipient view</button>
        </nav>
      )}
      {!isAuthed && (
        <nav className="topbar-nav">
          <button onClick={() => onNav("landing")} className={screen === "landing" ? "active" : ""}>Overview</button>
          <button onClick={() => onNav("recipient")} className={screen === "recipient" ? "active" : ""}>Recipient view</button>
        </nav>
      )}

      {!wallet && (
        <button className="btn btn-ghost btn-sm" onClick={onConnect}>
          <Icon name="wallet" size={14}/> Connect wallet
        </button>
      )}
      {wallet && (
        <div className="account-pill" onClick={onDisconnect} title="Click to disconnect">
          <span className="avatar"></span>
          <span className="mono" style={{fontSize: 12}}>{shortAddr(wallet.address)}</span>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="center" style={{gap: 14, flexWrap: "wrap"}}>
        <span>© DeadDrop</span>
        <span className="faint">·</span>
        <span>Open-source · audited 2025</span>
      </div>
      <div className="row" style={{gap: 18, flexWrap: "wrap"}}>
        <span className="mono">v0.4.1</span>
        <span className="faint">·</span>
        <a href="#" style={{color: "var(--text-3)", textDecoration: "none"}}>Security</a>
        <a href="#" style={{color: "var(--text-3)", textDecoration: "none"}}>Docs</a>
        <a href="#" style={{color: "var(--text-3)", textDecoration: "none"}}>Github</a>
      </div>
    </footer>
  );
}

// Hex map mirrors ACCENT_PALETTES — TweakColor wants hex (browsers can't sample oklch).
const ACCENT_HEX = {
  amber: "#e8a838",
  ember: "#d96a3a",
  iris:  "#a98ce0",
  jade:  "#7dc8a0",
};
const HEX_TO_ACCENT = Object.fromEntries(Object.entries(ACCENT_HEX).map(([k, v]) => [v.toLowerCase(), k]));

function Tweaks({ t, setTweak, setScreen }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Quick jump">
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6}}>
          <button className="btn btn-ghost btn-sm" onClick={() => setScreen("landing")}>Landing</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScreen("upload")}>Upload</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScreen("condition")}>Condition</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScreen("confirm")}>Confirm</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScreen("dashboard")}>Dashboard</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScreen("recipient")}>Recipient</button>
        </div>
      </TweakSection>

      <TweakSection label="Accent">
        <TweakColor
          label="Signal color"
          value={ACCENT_HEX[t.accent] || ACCENT_HEX.amber}
          onChange={(hex) => setTweak("accent", HEX_TO_ACCENT[String(hex).toLowerCase()] || "amber")}
          options={Object.values(ACCENT_HEX)}
        />
      </TweakSection>

      <TweakSection label="Typography">
        <TweakSelect
          label="Type system"
          value={t.typeface}
          onChange={(v) => setTweak("typeface", v)}
          options={[
            { value: "geist-instrument", label: "Geist + Instrument Serif" },
            { value: "switzer-fraunces", label: "Switzer + Spectral" },
          ]}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
