export default function ServicesLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      {/* Category 1 */}
      <div>
        <div className="skeleton h-5 w-32 rounded mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="skeleton h-28 rounded-xl" />
          <div className="skeleton h-28 rounded-xl" />
          <div className="skeleton h-28 rounded-xl" />
        </div>
      </div>
      {/* Category 2 */}
      <div>
        <div className="skeleton h-5 w-40 rounded mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="skeleton h-28 rounded-xl" />
          <div className="skeleton h-28 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
