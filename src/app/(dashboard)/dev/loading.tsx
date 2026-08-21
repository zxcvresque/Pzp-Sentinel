export default function DevBoardLoading() {
  return (
    <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4 md:p-8">
      {/* Kanban columns */}
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className="min-w-0 flex flex-col gap-3">
          {/* Column header */}
          <div className="skeleton h-7 w-24 rounded-lg" />
          {/* Cards */}
          {Array.from({ length: 3 + (col % 2) }).map((_, card) => (
            <div key={card} className="skeleton h-20 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
