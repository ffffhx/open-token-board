"use client";

import Link from "next/link";

import { usePrivateBenchmarkAccess } from "@/components/private-benchmark-access";

export function PrivateBenchmarkLink({
  className,
  href = "/bench",
}: {
  className?: string;
  href?: string;
}) {
  const access = usePrivateBenchmarkAccess();

  if (!access.allowed) {
    return null;
  }

  return (
    <Link href={href} className={className}>
      查看 Codex 评测
    </Link>
  );
}
