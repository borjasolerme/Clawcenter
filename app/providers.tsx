"use client";

import { Toast } from "@heroui/react";
import { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      <Toast.Provider placement="bottom end" />
      {children}
    </>
  );
}
