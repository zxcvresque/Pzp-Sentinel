export default function PublicPage() {
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <img
        src="/login-bg.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-6">
        <h1
          className="text-5xl sm:text-7xl font-extrabold text-white select-none mb-4 whitespace-nowrap"
          style={{ letterSpacing: "0.05em" }}
        >
          {"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}
        </h1>

        <p className="text-white/35 text-sm tracking-[0.25em] uppercase mb-14">
          PzP Finance &amp; Developers Hub
        </p>

        <a
          href="/login"
          className="group inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full text-sm font-semibold transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          Sign in
        </a>
      </div>
    </div>
  );
}
