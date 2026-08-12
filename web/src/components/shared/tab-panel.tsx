"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React from "react";

import { cn } from "@/lib/utils";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  /** The currently selected tab value */
  selected: string | number;
  /** The value this panel corresponds to */
  value: string | number;
  children?: React.ReactNode;
  className?: string;
  /** Class applied to the inner content wrapper */
  innerClassName?: string;
  /** Whether to animate panel transitions with framer-motion (default: true) */
  animated?: boolean;
  /** Keep content mounted in the DOM even when not selected (default: false) */
  preserveContent?: boolean;
}

/**
 * Accessible tab panel that shows/hides content based on the selected tab.
 * Supports animated transitions via framer-motion and optional content preservation.
 *
 * @example
 * ```tsx
 * <TabPanel selected={activeTab} value="settings">
 *   <SettingsForm />
 * </TabPanel>
 * ```
 */
const TabPanel = React.forwardRef<HTMLDivElement, Props>(
  ({ selected, value, children, className, innerClassName, animated = true, preserveContent = false }, ref) => {
    if (typeof selected !== typeof value) {
      throw new Error("TabPanel: selected and value must be of the same type");
    }

    const reduceMotion = useReducedMotion();
    const isSelected = selected === value;
    const content = <div className={cn("h-full w-full", innerClassName)}>{children}</div>;
    const shouldAnimate = animated && !reduceMotion;

    return (
      <div
        ref={ref}
        role="tabpanel"
        hidden={!isSelected}
        id={`tabpanel-${value}`}
        aria-labelledby={`tab-${value}`}
        aria-hidden={!isSelected}
        tabIndex={isSelected ? 0 : -1}
        className={cn("h-full w-full", className)}
      >
        {shouldAnimate ? (
          <AnimatePresence mode="wait">
            {(isSelected || preserveContent) && (
              <motion.div key={`${value}`} className="h-full w-full">
                {content}
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          (isSelected || preserveContent) && content
        )}
      </div>
    );
  },
);

TabPanel.displayName = "TabPanel";

export { TabPanel };
export type { Props as TabPanelProps };
