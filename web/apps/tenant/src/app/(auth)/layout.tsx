import React from "react";

import { cn } from "@heirs/ui";

interface Props {
  children: React.ReactNode;
}

const AuthLayout = ({ children }: Props) => {
  return (
    <div className="w-screen h-screen overflow-hidden grid place-items-center">
      <div className="space-y-6">
        <div></div>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="grid place-items-center lg:pr-4">
            <div className="flex flex-col justify-center gap-y-10 p-8">
              <div className="space-y-1">
                <h4 className="font-medium text-xl lg:text-4xl">Heirs OCR Service</h4>
                <p className="text-muted-foreground text-sm">Get started with</p>
              </div>
              <div className="relative grid h-50 w-full place-items-center">
                {[...Array(4)].map((_, i) => (
                  <div
                    className={cn("border-primary-300 bg-primary-50 absolute aspect-square rounded-md border shadow")}
                    key={i}
                    style={{
                      width: `${40 + i * 10}px`,
                      top: i < 2 ? "0" : "auto",
                      bottom: i >= 2 ? "0" : "auto",
                      left: i % 2 === 0 ? "0" : "auto",
                      right: i % 2 === 1 ? "0" : "auto",
                      transform: `rotate(${(i + 1) * 5}deg)`,
                    }}
                  ></div>
                ))}
                <div className=""></div>
              </div>
            </div>
          </div>
          <div className="lg:pl-4 lg:border-l">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
