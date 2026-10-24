"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";

export default function CopyReferralLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const t = useI18n().t.referral;

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <input
        readOnly
        value={link}
        onClick={(e) => e.currentTarget.select()}
        className="glass-input flex-1 rounded-xl px-4 py-3.5 text-sm font-mono"
      />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="btn-primary shrink-0 rounded-xl px-6 py-3.5 text-sm font-semibold"
      >
        {copied ? t.copied : t.copy}
      </button>
    </div>
  );
}
