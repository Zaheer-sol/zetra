"use client";

import dynamic from "next/dynamic";

const HeroThreeCanvas = dynamic(() => import("./hero-three-canvas"), {
  ssr: false,
  loading: () => <div className="size-full rounded-full border border-primary/10" />
});

export function HeroThreeScene() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative h-[390px] w-[min(420px,92vw)] shrink-0 max-md:h-[300px]"
    >
      <div className="absolute inset-[4%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,190,255,0.32),rgba(38,99,255,0.17)_42%,transparent_72%)] blur-2xl" />
      <HeroThreeCanvas />
      <div className="absolute right-2 bottom-6 rounded-full border border-white/55 bg-white/72 px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#17304a] shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-[#152338]/72 dark:text-[#dffbf5]">
        USDC payment · NEAR finality
      </div>
    </div>
  );
}
