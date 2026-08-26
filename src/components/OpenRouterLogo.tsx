import Image from "next/image";

export default function OpenRouterLogo({
  width = 38,
  className = "",
  priority = false,
  variant = "auto",
}: {
  width?: number;
  className?: string;
  priority?: boolean;
  variant?: "auto" | "mark" | "vertical";
}) {
  const isMark = variant === "mark" || (variant === "auto" && width <= 32);
  return (
    <Image
      src={isMark ? "/openrouter.webp" : "/vertical-volt@2x.webp"}
      alt=""
      aria-hidden="true"
      width={width}
      height={isMark ? width : Math.round(width * 1603 / 2048)}
      priority={priority}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
