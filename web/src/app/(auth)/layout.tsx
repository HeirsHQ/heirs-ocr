import React from "react";

interface Props {
  children: React.ReactNode;
}

const AuthLayout = ({ children }: Props) => {
  return (
    <div className="w-screen h-screen overflow-hidden grid place-items-center">
      <div className="space-y-6">
        <div></div>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="lg:pr-4">
            <div className="space-y-6 p-8 lg:min-w-125"></div>
          </div>
          <div className="lg:pl-4 lg:border-l">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
