import 'express';

declare global {
  namespace Express {
    interface UserPayload {
      id: string;
      email: string;
      username: string;
    }

    interface Request {
      user?: UserPayload;
    }
  }
}

export {};
