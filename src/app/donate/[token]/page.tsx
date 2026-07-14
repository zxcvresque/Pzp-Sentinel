import OneTimeDonationPage from "@/components/OneTimeDonationPage";

export const metadata = {
  title: "One-time Donation · Sentinel",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function GuestDonationRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OneTimeDonationPage token={token} />;
}
