import { HTTP_RESPONSE, HTTP_STATUS } from "../constants/index";

interface ErrorDetail {
  code: number;
  status: string;
  message: string;
  data: any;
  stack?: string;
}

export function createError(status: number, data: ErrorDetail[]) {
  return {
    status: data[0]?.status,
    data: data[0]?.data,
    error: true,
    message: data[0]?.message,
    stack: new Error().stack,
    statusCode: status,
  };
}

createError.InternalServerError = (data: any) => {
  return createError(HTTP_STATUS.INTERNAL_SERVER_ERROR, [
    {
      code: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      status: HTTP_RESPONSE.ERROR,
      message: data.message || "Internal Server Error.",
      data,
      stack: process.env.NODE_ENV === "development" ? new Error().stack : undefined,
    },
  ]);
};
