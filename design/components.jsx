// Shared atoms

const Icon = ({ name, size = 16, stroke = 1.5, ...rest }) => {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor",
    strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round",
    ...rest,
  };
  switch (name) {
    case "lock":
      return <svg {...common}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
    case "shield":
      return <svg {...common}><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z"/></svg>;
    case "key":
      return <svg {...common}><circle cx="9" cy="15" r="3.5"/><path d="M11.5 12.5L19 5M16 8l2 2M14 10l2 2"/></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14.5c2.8.5 6 2.3 6 5.5"/></svg>;
    case "upload":
      return <svg {...common}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></svg>;
    case "check":
      return <svg {...common}><path d="M4 12l5 5L20 6"/></svg>;
    case "x":
      return <svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "arrow-right":
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case "arrow-left":
      return <svg {...common}><path d="M19 12H5M11 18l-6-6 6-6"/></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>;
    case "download":
      return <svg {...common}><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>;
    case "file":
      return <svg {...common}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>;
    case "copy":
      return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
    case "eye":
      return <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>;
    case "alert":
      return <svg {...common}><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>;
    case "info":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/></svg>;
    case "refresh":
      return <svg {...common}><path d="M3 12a9 9 0 0 1 15-6.7l3 2.7M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M21 3v6h-6M3 21v-6h6"/></svg>;
    case "menu":
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case "dot":
      return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>;
    case "wallet":
      return <svg {...common}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M17 15h.01"/></svg>;
    default: return null;
  }
};

const Chip = ({ tone = "default", children }) => (
  <span className={`chip ${tone}`}>
    {tone !== "default" && <span className="chip-dot"></span>}
    {children}
  </span>
);

const TrustBadge = ({ label = "End-to-end encrypted on your device" }) => (
  <span className="trust-badge">
    <span className="dot"></span>
    <span>{label}</span>
  </span>
);

const Eyebrow = ({ children }) => <div className="eyebrow">{children}</div>;

const Steps = ({ current, steps }) => (
  <div className="steps">
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        <div className={`step ${i === current ? "active" : ""} ${i < current ? "done" : ""}`}>
          <div className="num">{i < current ? <Icon name="check" size={12} stroke={2} /> : (i + 1)}</div>
          <div className="label">{s}</div>
        </div>
        {i < steps.length - 1 && <div className="sep"></div>}
      </React.Fragment>
    ))}
  </div>
);

// Short address formatter
const shortAddr = (addr) =>
  !addr ? "" : `${addr.slice(0, 6)}…${addr.slice(-4)}`;

// Fake fingerprint generator
const makeFingerprint = (seed = Math.random()) => {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 64; i++) {
    s += hex[Math.floor((Math.sin(seed * 999 + i) * 0.5 + 0.5) * 16) % 16];
    if (i % 8 === 7 && i !== 63) s += " ";
  }
  return s;
};

// Format duration to human-readable
const fmtDur = (ms) => {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
};

const fmtCountdown = (ms) => {
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  const s = Math.floor(ms / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
};

// Two-digit
const pad = (n) => String(n).padStart(2, "0");

const Countdown = ({ ms, big = false, tone = "default" }) => {
  const t = fmtCountdown(ms);
  const color = tone === "armed" ? "var(--amber)" : tone === "triggered" ? "var(--red)" : "var(--text-1)";
  if (big) {
    return (
      <div style={{display: "flex", alignItems: "baseline", gap: 14, color}}>
        <span className="countdown"><span className="big">{t.d}</span><span className="unit">days</span></span>
        <span className="countdown"><span className="big">{pad(t.h)}</span><span className="unit">hrs</span></span>
        <span className="countdown"><span className="big">{pad(t.m)}</span><span className="unit">min</span></span>
        <span className="countdown"><span className="big">{pad(t.s)}</span><span className="unit">sec</span></span>
      </div>
    );
  }
  return (
    <span className="mono" style={{fontVariantNumeric: "tabular-nums", color, fontSize: 15}}>
      {t.d}d {pad(t.h)}:{pad(t.m)}:{pad(t.s)}
    </span>
  );
};

Object.assign(window, {
  Icon, Chip, TrustBadge, Eyebrow, Steps,
  shortAddr, makeFingerprint, fmtDur, fmtCountdown, pad, Countdown,
});
