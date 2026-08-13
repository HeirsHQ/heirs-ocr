"use client";

import { useState } from "react";

export const useValues = <T extends object>(defaultValues: T) => {
  const [values, setValues] = useState(defaultValues);

  const onValueChange = <K extends keyof T>(field: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  return { onValueChange, values };
};
