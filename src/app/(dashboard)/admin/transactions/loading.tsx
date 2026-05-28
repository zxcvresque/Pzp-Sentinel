export default function TransactionsLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 md:p-8">
      {/* Header */}
      <div className="skeleton h-8 w-48 rounded-lg" />
      {/* Filter row */}
      <div className="flex gap-3">
        <div className="skeleton h-9 w-36 rounded-lg" />
        <div className="skeleton h-9 w-36 rounded-lg" />
        <div className="skeleton h-9 w-24 rounded-lg" />
      </div>
      {/* Table rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton h-12 rounded-lg" />
      ))}
    </div>
  );
}
