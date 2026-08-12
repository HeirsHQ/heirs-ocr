"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
  subtitle?: string;
}

export const PageLayout = ({ children, title, actions, subtitle }: Props) => {
  return (
    <div className="h-full space-y-4">
      <div className="flex items-center justify-between">
        <div className="">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-x-4">{actions}</div>
      </div>
      <div className="w-full min-h-0">{children}</div>
    </div>
  );
};
