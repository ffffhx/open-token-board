import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicProfileClient } from "@/components/profile/public-profile-client";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://124-221-36-36.anyip.dev:8443/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.profileTitle,
  description: zh.common.metadata.profileDescription,
};

export default function UserProfilePage() {
  return (
    <Suspense fallback={<ProfilePageFallback />}>
      <PublicProfileClient apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL} />
    </Suspense>
  );
}

function ProfilePageFallback() {
  return (
    <main className="mx-auto min-h-[100svh] max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="otb-skeleton h-20 rounded-lg" />
      <div className="otb-skeleton mt-5 h-80 rounded-lg" />
    </main>
  );
}
