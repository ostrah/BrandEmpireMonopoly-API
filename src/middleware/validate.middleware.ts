import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { HttpError } from '../utils/httpError.js';

export const validateBody = <T>(schema: ZodSchema<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(HttpError.badRequest('validation_error', 'Invalid request body', err.flatten().fieldErrors));
        return;
      }
      next(err);
    }
  };

export const validateQuery = <T>(schema: ZodSchema<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.query);
      Object.assign(req.query as object, parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(HttpError.badRequest('validation_error', 'Invalid query', err.flatten().fieldErrors));
        return;
      }
      next(err);
    }
  };
