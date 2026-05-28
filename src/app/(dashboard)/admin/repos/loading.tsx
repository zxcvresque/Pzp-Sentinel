export default function ReposLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 md:p-8">
      {/* Header */}
      <div className="skeleton h-8 w-36 rounded-lg" />
      {/* Repo list rows */}
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="skeleton h-16 rounded-xl" />
      ))}
    </div>
  );
}
