"use client";

import { Eye, EyeOff, Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type PasswordStrength = "weak" | "fair" | "strong";

function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const isLong = password.length >= 12;

  const score = [hasLower, hasUpper, hasNumber, hasSpecial, isLong].filter(Boolean).length;

  if (score >= 4) return "strong";
  if (score >= 3) return "fair";
  return "weak";
}

const strengthConfig: Record<PasswordStrength, { label: string; className: string }> = {
  weak: { label: "Weak", className: "bg-red-100 text-red-600" },
  fair: { label: "Fair", className: "bg-yellow-100 text-yellow-600" },
  strong: { label: "Strong", className: "bg-green-100 text-green-600" },
};

function Input({
  className,
  containerClassName,
  type,
  showStrength = false,
  ref,
  ...props
}: React.ComponentProps<"input"> & {
  /** Classes for the outer relative wrapper (use for width in flex toolbars). */
  containerClassName?: string;
  /** Shows the Weak/Fair/Strong badge — only meaningful where a *new* password is being
   *  chosen (signup, reset/change password). Entering an existing password (login, a
   *  confirm-to-proceed prompt) has nothing to grade, so this defaults to off. */
  showStrength?: boolean;
}) {
  const [showPassword, setShowPassword] = React.useState(false);
  const [passwordValue, setPasswordValue] = React.useState("");
  const [uncontrolledSearchValue, setUncontrolledSearchValue] = React.useState(() => String(props.defaultValue ?? ""));
  const inputRef = React.useRef<HTMLInputElement>(null);

  const isPassword = type === "password";
  const isSearch = type === "search";
  const isFile = type === "file";
  const isControlled = props.value !== undefined;
  const searchValue = isControlled ? String(props.value ?? "") : uncontrolledSearchValue;
  const showClear = isSearch && searchValue.length > 0 && !props.disabled && !props.readOnly;

  const strength = isPassword && showStrength ? getPasswordStrength(passwordValue) : null;

  const setInputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPassword) setPasswordValue(e.target.value);
    if (isSearch && !isControlled) setUncontrolledSearchValue(e.target.value);
    props.onChange?.(e);
  };

  const clearSearch = () => {
    if (!isControlled && inputRef.current) {
      inputRef.current.value = "";
      setUncontrolledSearchValue("");
    }
    props.onChange?.({
      target: { value: "" },
      currentTarget: { value: "" },
    } as React.ChangeEvent<HTMLInputElement>);
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative w-full", containerClassName)}>
      {isSearch && <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />}
      <input
        type={isPassword && showPassword ? "text" : type}
        data-slot="input"
        className={cn(
          "file:text-foreground input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-8 w-full min-w-0 appearance-none rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow,border] duration-150 outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:border-red-500",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          isPassword && "pr-24",
          isSearch && "pl-9",
          showClear && "pr-9",
          isFile && "text-muted-foreground",
          className,
        )}
        {...props}
        ref={setInputRef}
        onChange={handleChange}
      />
      {showClear && (
        <button
          type="button"
          onClick={clearSearch}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer"
          tabIndex={-1}
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
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
