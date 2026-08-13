"use client";

import { useState } from "react";

/**
 * TgUser — reusable inline user display with Telegram profile photo + clickable name.
 *
 * Usage:
 *   <TgUser name="Varad" telegramUser="varad" photoUrl="/photo.jpg" />
 *   <TgUser name="Varad" />  // no photo, no link — falls back to initials
 */

interface TgUserProps {
  name: string;
  telegramUser?: string | null;
  photoUrl?: string | null;
  /** Avatar size in px. Default 24 */
  size?: number;
  /** Override avatar bg color. Default based on name initial */
  color?: string;
  /** Hide the text name, show only avatar */
  avatarOnly?: boolean;
  /** Extra CSS classes on the wrapper */
  className?: string;
  /** Extra CSS classes on the displayed name */
  nameClassName?: string;
}

const COLORS = [
  "var(--violet)",
  "var(--mint)",
  "var(--coral)",
  "var(--amber)",
  "var(--cyan)",
  "var(--rose)",
];

function pickColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function TgUser({
  name,
  telegramUser,
  photoUrl,
  size = 24,
  color,
  avatarOnly = false,
  className = "",
  nameClassName = "",
}: TgUserProps) {
  const initial = name.charAt(0).toUpperCase();
  const bg = color || pickColor(name);
  const fontSize = Math.max(9, Math.round(size * 0.42));
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);

  const fallback = (
    <span
      className="rounded-full flex items-center justify-center flex-shrink-0 font-bold select-none"
      style={{
        width: size,
        height: size,
        fontSize,
        background: `color-mix(in srgb, ${bg} 15%, transparent)`,
        color: bg,
      }}
    >
      {initial}
    </span>
  );

  const avatar = photoUrl && failedPhotoUrl !== photoUrl ? (
    <img
      src={photoUrl}
      alt={name}
      className="rounded-full object-cover flex-shrink-0"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
      onError={() => setFailedPhotoUrl(photoUrl)}
    />
  ) : (
    fallback
  );

  const content = (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      style={{ lineHeight: 1 }}
    >
      {avatar}
      {!avatarOnly && (
        <span className={`truncate text-sm text-[var(--text-primary)] ${nameClassName}`}>{name}</span>
      )}
    </span>
  );

  if (telegramUser) {
    return (
      <a
        href={`https://t.me/${telegramUser}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity ${className}`}
        style={{ lineHeight: 1, textDecoration: "none" }}
        title={`@${telegramUser}`}
      >
        {avatar}
        {!avatarOnly && (
          <span className={`truncate text-sm text-[var(--text-primary)] ${nameClassName}`}>{name}</span>
        )}
      </a>
    );
  }

  return content;
}
