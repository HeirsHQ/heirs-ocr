"use client";

import React, { useRef } from "react";

import { cn } from "../../lib/utils";

interface OtpInputProps {
  /** Called with the updated OTP string on every change */
  onChange: (value: string) => void;
  /** Current OTP string value */
  value: string;
  className?: string
  disabled?: boolean;
  /** Number of OTP digits (default: 6) */
  length?: number;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Numeric OTP input that renders individual digit boxes.
 * Handles paste, backspace navigation, and digit-only validation.
 *
 * @example
 * ```tsx
 * <OtpInput length={6} value={otp} onChange={setOtp} />
 * ```
 */

function OtpInput({ onChange, value, className, disabled, length = 6, onKeyDown }: OtpInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, char: string) => {
    if (!/^\d*$/.test(char)) return;

    const digits = value.split("");
    digits[index] = char;
    const next = digits.join("").slice(0, length);
    onChange(next);

    if (char && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    inputsRef.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex items-center justify-center gap-2.5">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          disabled={disabled}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={cn(
            "border-input focus-visible:border-primary size-9 rounded-md border bg-transparent text-center font-semibold shadow-xs transition-[color,box-shadow,border] duration-150 outline-none",
            className,
          )}
        />
      ))}
    </div>
  );
}

export { OtpInput };
