export default function DevBoardLoading() {
  return (
    <div className="flex gap-4 p-6 md:p-8 overflow-x-auto">
      {/* Kanban columns */}
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className="flex flex-col gap-3 min-w-[220px] flex-shrink-0">
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
