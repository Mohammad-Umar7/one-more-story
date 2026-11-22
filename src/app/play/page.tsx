"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// There is no game menu: the player never chooses. The companion opens the
// day's game (the story) and leads on from there, so this address simply
// goes back to the companion.
export default function NoGameMenu() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return <div className="night" />;
}
