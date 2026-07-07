"use client";

import Link from "next/link";

import { usePrivateBenchmarkAccess } from "@/components/private-benchmark-access";
import { useI18n } from "@/i18n";

export function PrivateBenchmarkLink({
  className,
  href = "/bench",
}: {
  className?: string;
  href?: string;
}) {
  const { dict } = useI18n();
  const access = usePrivateBenchmarkAccess();

  if (!access.allowed) {
    return null;
  }

  return (
    <Link href={href} className={className}>
      {dict.benchmark.access.privateLink}
    </Link>
  );
}
