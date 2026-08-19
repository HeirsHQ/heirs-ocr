"use client";

import { Eye, EyeOff, Search } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

type PasswordStrength = "weak" | "fair" | "strong";

function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const isLong = password.length >= 8;

  const score = [hasLower, hasUpper, hasNumber, hasSpecial, isLong].filter(Boolean).length;

  if (score >= 4) return "strong";
  if (score >= 3) return "fair";
  return "weak";
}

const strengthConfig: Record<PasswordStrength, { label: string; className: string }> = {
  weak: { label: "Weak", className: "bg-red-100 text-red-500" },
  fair: { label: "Fair", className: "bg-yellow-100 text-yellow-500" },
  strong: { label: "Strong", className: "bg-green-100 text-green-500" },
};

function Input({ className, type, wrapperClassName, ...props }: React.ComponentProps<"input"> & {
  wrapperClassName?: string
}) {
  const [showPassword, setShowPassword] = React.useState(false);
  const [passwordValue, setPasswordValue] = React.useState("");

  const isPassword = type === "password";
  const isSearch = type === "search";

  const strength = isPassword ? getPasswordStrength(passwordValue) : null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPassword) setPasswordValue(e.target.value);
    props.onChange?.(e);
  };

  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      {isSearch && <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />}
      <input
        type={isPassword && showPassword ? "text" : type}
        data-slot="input"
        className={cn(
          "file:text-foreground input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-8 w-full min-w-0 appearance-none rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow,border] duration-150 outline-none file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring file:cursor-pointer",
          "aria-invalid:border-destructive dark:aria-invalid:border-destructive/50",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          isPassword && "pr-24",
          isSearch && "pl-9",
          className,
        )}
        {...props}
        onChange={handleChange}
      />
      {isPassword && (
        <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1.5">
          {strength && (
            <span
              className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", strengthConfig[strength].className)}
            >
              {strengthConfig[strength].label}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="text-muted-foreground cursor-pointer"
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

export { Input };
