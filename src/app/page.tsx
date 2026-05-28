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

        <style>{`
          @keyframes glass-shine {
            0% { transform: translateX(-100%) skewX(-15deg); }
            100% { transform: translateX(250%) skewX(-15deg); }
          }
          .signin-btn {
            position: relative;
            overflow: hidden;
          }
          .signin-btn::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 40%;
            height: 100%;
            background: linear-gradient(
              90deg,
              transparent,
              rgba(255,255,255,0.15),
              transparent
            );
            transform: translateX(-100%) skewX(-15deg);
          }
          .signin-btn:hover::after {
            animation: glass-shine 0.6s ease forwards;
          }
          .signin-btn:hover {
            background: rgba(255,255,255,0.14) !important;
            border-color: rgba(255,255,255,0.25) !important;
            color: #fff !important;
            transform: translateY(-1px);
          }
          .signin-btn:active {
            transform: translateY(0) scale(0.97) !important;
          }
        `}</style>
        <a
          href="/login"
          className="signin-btn group inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full text-sm font-semibold transition-all duration-300 active:scale-[0.97]"
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
