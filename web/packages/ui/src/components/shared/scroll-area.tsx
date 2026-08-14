import React from "react";

import { cn } from "../../lib/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Hide the scrollbar visually while keeping scroll functionality (default: false) */
  hideScrollbar?: boolean;
  /** Scroll direction(s) to enable (default: "vertical") */
  orientation?: "horizontal" | "vertical" | "both";
  /** Side the scrollbar appears on (default: "right") */
  scrollbarSide?: "left" | "right";
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Thin wrapper around a scrollable div with orientation and scrollbar visibility control.
 *
 * @example
 * ```tsx
 * <ScrollArea className="h-64">
 *   <LongContent />
 * </ScrollArea>
 * ```
 */

export const ScrollArea = ({
  children,
  className,
  orientation = "vertical",
  hideScrollbar = false,
  scrollbarSide = "right",
  ref,
}: Props) => {
  return (
    <div
      className={cn(
        "scroll-area overflow-auto",
        orientation === "vertical" && "overflow-x-hidden overflow-y-auto",
        orientation === "horizontal" && "overflow-x-auto overflow-y-hidden",
        orientation === "both" && "overflow-auto",
        hideScrollbar ? "scrollbar-hide" : "custom-scrollbar",
        scrollbarSide === "left" && "[direction:rtl] *:[direction:ltr]",
        className,
      )}
      ref={ref}
    >
      {children}
    </div>
  );
};
