import Image from "next/image";

const RAZORPAY_ICON = "/Payment%20Apps%20Icons/razorpay-logo-notext.png";

const SIZES = {
  xs: { shell: "h-5 w-5", icon: "h-3.5 w-3.5", pixels: 14 },
  sm: { shell: "h-7 w-7", icon: "h-5 w-5", pixels: 20 },
  md: { shell: "h-8 w-8", icon: "h-[22px] w-[22px]", pixels: 22 },
} as const;

export default function RazorpayMark({
  size = "sm",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dimensions = SIZES[size];

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5 ${dimensions.shell} ${className}`}
    >
      <Image
        src={RAZORPAY_ICON}
        alt="Razorpay"
        width={dimensions.pixels}
        height={dimensions.pixels}
        className={`${dimensions.icon} object-contain`}
      />
    </span>
  );
}
