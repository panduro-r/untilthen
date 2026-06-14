// Brand marks for the connect modal. Petra's real icon comes from the wallet adapter (data URI);
// these inline SVGs cover the "coming soon" wallets the adapter can't supply until they're wired.

type LogoProps = { size?: number }

export function PetraLogo({ size = 32 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#5C3DF4" />
      <path
        d="M11 8.5h6.4a4.8 4.8 0 0 1 0 9.6h-3v5.4H11V8.5Zm3.4 3.1v3.4h2.6a1.7 1.7 0 0 0 0-3.4h-2.6Z"
        fill="#fff"
      />
    </svg>
  )
}

export function PhantomLogo({ size = 32 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#AB9FF2" />
      <path
        d="M9 16a7 7 0 0 1 14 0v6.3c0 .7-.8 1.1-1.4.7l-1-.7a1.1 1.1 0 0 0-1.3.1l-.9.8a1.1 1.1 0 0 1-1.4 0l-.9-.8a1.1 1.1 0 0 0-1.4 0l-.9.8a1.1 1.1 0 0 1-1.4 0l-.9-.8a1.1 1.1 0 0 0-1.3-.1l-1 .7c-.6.4-1.4 0-1.4-.7V16Z"
        fill="#fff"
      />
      <ellipse cx="13.4" cy="15.2" rx="1.15" ry="1.7" fill="#534BB1" />
      <ellipse cx="18.2" cy="15.2" rx="1.15" ry="1.7" fill="#534BB1" />
    </svg>
  )
}

export function MetaMaskLogo({ size = 32 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#24242E" />
      <path d="M23.3 7.5 17.4 12l1.1-2.7 4.8-1.8Z" fill="#E2761B" stroke="#E2761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M8.7 7.5 14.5 12l-1-2.7-4.8-1.8Z" fill="#E4761B" stroke="#E4761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M21.1 19.4 19.5 22l3.4 1 1-3.5-2.8-.1ZM8.1 19.5l1 3.5 3.4-1-1.6-2.6-2.8.1Z" fill="#E4761B" stroke="#E4761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m12.3 14.6-1 1.5 3.4.2-.1-3.7-2.3 2ZM19.7 14.6l-2.3-2-.1 3.8 3.4-.2-1-1.6ZM12.5 22l2.1-1-1.8-1.4-.3 2.4ZM17.4 21l2.1 1-.3-2.4-1.8 1.4Z" fill="#E4761B" stroke="#E4761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m19.5 22-2.1-1 .2 1.4v.6l1.9-1ZM12.5 22l1.9 1v-.6l.1-1.4-2 1Z" fill="#D7C1B3" stroke="#D7C1B3" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m14.5 18.6-1.7-.5 1.2-.6.5 1.1ZM17.5 18.6l.5-1.1 1.2.6-1.7.5Z" fill="#233447" stroke="#233447" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m12.5 22 .3-2.6-2 .1 1.7 2.5ZM19.2 19.4l.3 2.6 1.7-2.5-2-.1ZM20.7 16.1l-3.4.2.3 1.7.5-1.1 1.2.6 1.4-1.4ZM12.8 18.1l1.2-.6.5 1.1.3-1.7-3.4-.2 1.4 1.4Z" fill="#CD6116" stroke="#CD6116" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m11.4 16.1 1.4 2.8-.1-1.4-1.3-1.4ZM19.5 17.5l-.1 1.4 1.4-2.8-1.3 1.4ZM14.8 16.3l-.3 1.7.4 2 .1-2.7-.2-1ZM17.3 16.3l-.1 1 .1 2.7.4-2-.4-1.7Z" fill="#E4751F" stroke="#E4751F" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m17.7 18.6-.4 2 .3.2 1.8-1.4.1-1.4-1.8.6ZM12.8 18.1l.1 1.4 1.8 1.4.3-.2-.4-2-1.8-.6Z" fill="#F6851B" stroke="#F6851B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m17.8 23.4v-.6l-.2-.1h-3.2l-.2.1v.6l-1.7-.8.6.5 1.2.8h3.3l1.2-.8.6-.5-1.7.8Z" fill="#C0AD9E" stroke="#C0AD9E" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m17.5 21-.3-.2h-2.4l-.3.2-.1 1.4.2-.1h3.2l.2.1-.2-1.4Z" fill="#161616" stroke="#161616" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m23.5 12.3.5-2.4-.8-2.4-6.2 4.6 2.4 2 3.4 1 .7-.9-.3-.2.5-.5-.4-.3.5-.4-.3-.2ZM8 9.9l.5 2.4-.3.2.5.4-.4.3.5.4-.3.2.7.9 3.4-1 2.4-2L8.8 7.5 8 9.9Z" fill="#763D16" stroke="#763D16" strokeWidth=".4" strokeLinejoin="round" />
      <path d="m22.8 16.4-3.4-1 1 1.6-1.4 2.8 1.9-.1h2.8l-.9-3.3ZM12.6 15.4l-3.4 1-.9 3.3h2.8l1.9.1-1.4-2.8 1-1.6ZM17.3 16.3l.2-3.7 1-2.7h-4.9l1 2.7.2 3.7.1 1.1v2.7h2.3v-2.7l.1-1.1Z" fill="#F6851B" stroke="#F6851B" strokeWidth=".4" strokeLinejoin="round" />
    </svg>
  )
}

export function WalletConnectLogo({ size = 32 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#3B99FC" />
      <path
        d="M10.3 13.7c3.1-3 8.3-3 11.4 0l.4.4c.15.15.15.4 0 .55l-1.3 1.25a.2.2 0 0 1-.28 0l-.5-.5c-2.2-2.1-5.75-2.1-7.95 0l-.55.53a.2.2 0 0 1-.28 0l-1.3-1.25a.4.4 0 0 1 0-.55l.36-.43Zm14.08 2.6 1.16 1.12a.4.4 0 0 1 0 .55l-5.2 5.02a.42.42 0 0 1-.57 0l-3.7-3.56a.1.1 0 0 0-.14 0l-3.7 3.56a.42.42 0 0 1-.57 0l-5.2-5.02a.4.4 0 0 1 0-.55l1.16-1.12a.42.42 0 0 1 .57 0l3.7 3.57a.1.1 0 0 0 .14 0l3.7-3.57a.42.42 0 0 1 .57 0l3.7 3.57a.1.1 0 0 0 .14 0l3.7-3.57a.42.42 0 0 1 .57 0Z"
        fill="#fff"
      />
    </svg>
  )
}
