export default function PublicPage() {
  return (
    <div className="min-h-screen text-text-primary flex flex-col relative overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/login-bg.png')",
          filter: "brightness(1.3)",
        }}
      />
      {/* Overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.5) 100%)",
        }}
      />

      <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto px-6 py-20 w-full relative z-10">
        <div className="text-center mb-16">
          <h1 className="text-5xl sm:text-6xl text-lime mb-3 font-extrabold" style={{ letterSpacing: "0.05em" }}>
            {"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}
          </h1>
          <p className="text-text-secondary text-lg tracking-wide mb-4">
            PzP Finance &amp; Developers Hub
          </p>
          <p className="text-text-tertiary text-sm max-w-md mx-auto">
            Community treasury and project board for PzP — every rupee tracked, every task visible.
          </p>
        </div>

        <a
          href="/login"
          className="inline-block bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          Sign in
        </a>
      </div>
    </div>
  );
}
