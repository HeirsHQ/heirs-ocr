import { Response } from "express";

interface ResponseProps<T extends object> {
  data: T;
  message: string;
  success: number;
}

export const createResponse =
  <T extends object>({ data, message, success }: ResponseProps<T>) =>
  (response: Response, status: number) => {
    return response.status(status).json({ data, message, success });
  };
