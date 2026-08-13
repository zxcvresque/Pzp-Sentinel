import PaymentMethodBadge from "@/components/PaymentMethodBadge";
import TgUser from "@/components/TgUser";

interface TransactionPerson {
  name: string;
  photoUrl?: string | null;
  telegramUser?: string | null;
}

export default function TransactionAttribution({
  fromUser,
  createdBy,
  method,
  detail,
  size = 26,
}: {
  fromUser?: TransactionPerson | null;
  createdBy?: TransactionPerson | null;
  method: string;
  detail?: string | null;
  size?: number;
}) {
  const normalizedMethod = method.toUpperCase();
  const isCapturedPlatform = normalizedMethod === "RAZORPAY" || normalizedMethod === "BMC";

  if (isCapturedPlatform && !fromUser) {
    return <PaymentMethodBadge method={method} detail={detail} />;
  }

  if (isCapturedPlatform && fromUser) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
        <TgUser
          name={fromUser.name}
          telegramUser={fromUser.telegramUser}
          photoUrl={fromUser.photoUrl}
          size={size}
          nameClassName="!text-[14px] font-semibold"
        />
        <span>donated through</span>
        <PaymentMethodBadge method={method} detail={detail} />
      </span>
    );
  }

  if (createdBy) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
        <TgUser
          name={createdBy.name}
          telegramUser={createdBy.telegramUser}
          photoUrl={createdBy.photoUrl}
          size={size}
          nameClassName="!text-[14px] font-semibold"
        />
        <span>noted this</span>
      </span>
    );
  }

  return <span className="text-[10px] text-text-tertiary">Manually noted</span>;
}
