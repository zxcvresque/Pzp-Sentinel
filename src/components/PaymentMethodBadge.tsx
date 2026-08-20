import Image from "next/image";

const ASSET_ROOT = "/Payment%20Apps%20Icons";
const UPI_ICON = { src: `${ASSET_ROOT}/500px-UPI-Logo.webp`, alt: "UPI" };

const DETAIL_ICONS: Record<string, { src: string; alt: string }> = {
  google_pay: { src: `${ASSET_ROOT}/google-pay-light.svg`, alt: "Google Pay" },
  phonepe: { src: `${ASSET_ROOT}/PhonePe-Logo.wine.svg`, alt: "PhonePe" },
  paytm: { src: `${ASSET_ROOT}/Paytm-Logo.wine.svg`, alt: "Paytm" },
  amazon_pay: { src: `${ASSET_ROOT}/amazon-pay-light.svg`, alt: "Amazon Pay" },
  mobikwik: { src: `${ASSET_ROOT}/MobiKwik-Logo.wine.svg`, alt: "MobiKwik" },
  apple_pay: { src: `${ASSET_ROOT}/apple-pay-light.svg`, alt: "Apple Pay" },
  samsung_pay: { src: `${ASSET_ROOT}/samsung-pay-light.svg`, alt: "Samsung Pay" },
  visa: { src: `${ASSET_ROOT}/visa-light.svg`, alt: "Visa" },
  mastercard: { src: `${ASSET_ROOT}/mastercard-light.svg`, alt: "Mastercard" },
  amex: { src: `${ASSET_ROOT}/amex-light.svg`, alt: "American Express" },
  card: { src: `${ASSET_ROOT}/cards.webp`, alt: "Card" },
  upi: UPI_ICON,
};

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function detailLabel(detail?: string | null) {
  if (!detail) return null;
  const [rail, value] = detail.split(":", 2);
  if (rail === "upi") return value && value !== "upi" ? `${titleCase(value)} UPI` : "UPI";
  if (rail === "card") return value && value !== "card" ? titleCase(value) : "Card";
  if (rail === "wallet") return value && value !== "wallet" ? `${titleCase(value)} wallet` : "Wallet";
  if (rail === "netbanking") return "Netbanking";
  return titleCase(rail);
}

export default function PaymentMethodBadge({
  method,
  detail,
  compact = false,
}: {
  method: string;
  detail?: string | null;
  compact?: boolean;
}) {
  const normalizedMethod = method.toUpperCase();
  const [rail = "", rawValue = ""] = detail?.toLowerCase().split(":", 2) || [];
  const iconKey = rawValue.replace(/[^a-z0-9_]/g, "");
  const detailIcon = DETAIL_ICONS[iconKey] || (rail === "card" ? DETAIL_ICONS.card : null);
  const label = detailLabel(detail);

  if (normalizedMethod === "BMC") {
    return (
      <span title="Buy Me a Coffee" className="inline-flex items-center gap-1.5 rounded-full border border-amber/20 bg-amber/[.06] px-2 py-1 text-[10px] font-semibold text-amber">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-white p-0.5 shadow-sm">
          <Image src={`${ASSET_ROOT}/bmc-logo-no-background.png`} alt="Buy Me a Coffee" width={11} height={16} className="h-4 w-auto object-contain" />
        </span>
        {!compact && <span>BMC</span>}
      </span>
    );
  }

  if (normalizedMethod === "RAZORPAY") {
    return (
      <span title={label ? `Razorpay · ${label}` : "Razorpay"} className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/20 bg-sky-400/[.06] px-2 py-1 text-[10px] font-semibold text-sky-300">
        <Image src={`${ASSET_ROOT}/razorpay-logo-notext.png`} alt="Razorpay" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
        {detailIcon ? (
          <Image
            src={detailIcon.src}
            alt={detailIcon.alt}
            width={detailIcon === UPI_ICON ? 40 : 24}
            height={16}
            className={detailIcon === UPI_ICON ? "h-4 w-10 object-contain" : "h-4 w-6 rounded object-contain"}
          />
        ) : null}
        {!compact && <span>{label ? `Razorpay · ${label}` : "Razorpay"}</span>}
      </span>
    );
  }

  if (normalizedMethod === "UPI") {
    return <span className="text-[10px] text-text-tertiary">UPI</span>;
  }

  if (normalizedMethod === "OTHER") {
    return <span className="text-[10px] text-text-tertiary">Admin noted</span>;
  }

  return <span className="text-[10px] text-text-tertiary">{titleCase(method.toLowerCase())}</span>;
}
