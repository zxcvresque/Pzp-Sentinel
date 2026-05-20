import { prisma } from "@/lib/db";

export const revalidate = 60;

interface PublicSub {
  platform: string;
  price: unknown;
  currency: string;
  frequency: string;
  expiryDate: Date;
}

async function getPublicStats() {
  const approved = await prisma.transaction.findMany({
    where: { status: "APPROVED" },
    select: { amount: true, direction: true },
  });

  const totalDonated = approved
    .filter((t: { direction: string }) => t.direction === "IN")
    .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount), 0);

  const totalSpent = approved
    .filter((t: { direction: string }) => t.direction === "OUT")
    .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount), 0);

  const donorCount = await prisma.user.count({
    where: { roles: { has: "DONOR" } },
  });

  const subscriptions = await prisma.subscription.findMany({
    where: { status: "ACTIVE" },
    select: { platform: true, price: true, currency: true, frequency: true, expiryDate: true },
    orderBy: { platform: "asc" },
  });

  return { totalDonated, totalSpent, balance: totalDonated - totalSpent, donorCount, subscriptions };
}

export default async function PublicPage() {
  const { totalDonated, totalSpent, balance, donorCount, subscriptions } = await getPublicStats();

  return (
    <div className="min-h-screen bg-bg-void text-text-primary">
      <div className="grain" />
      <div className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="text-4xl font-extrabold mb-2">
          PzP <span className="font-display text-lime">Finance</span>
        </h1>
        <p className="text-text-secondary text-sm mb-12">
          Community treasury — transparent by default.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
          <div className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
              Balance
            </div>
            <div className="text-2xl font-extrabold text-mint">
              ₹{balance.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
              Donated
            </div>
            <div className="text-2xl font-extrabold">
              ₹{totalDonated.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
              Spent
            </div>
            <div className="text-2xl font-extrabold text-coral">
              ₹{totalSpent.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
              Donors
            </div>
            <div className="text-2xl font-extrabold text-violet">
              {donorCount}
            </div>
          </div>
        </div>

        {subscriptions.length > 0 && (
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4">
              Active Subscriptions
            </h2>
            <div className="space-y-2">
              {subscriptions.map((s: PublicSub) => (
                <div key={s.platform} className="card p-4 flex items-center justify-between">
                  <span className="text-sm font-medium">{s.platform}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-mint font-semibold text-sm">
                      {s.currency === "INR" ? "₹" : "$"}
                      {Number(s.price).toLocaleString()}/{s.frequency === "YEARLY" ? "yr" : "mo"}
                    </span>
                    <span className="text-text-tertiary text-xs">
                      expires {new Date(s.expiryDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-16 text-center">
          <a
            href="/login"
            className="inline-block bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
          >
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
