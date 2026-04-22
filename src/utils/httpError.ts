export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new HttpError(400, code, message, details);
  }

  static unauthorized(code = 'unauthorized', message = 'Unauthorized') {
    return new HttpError(401, code, message);
  }

  static forbidden(code = 'forbidden', message = 'Forbidden') {
    return new HttpError(403, code, message);
  }

  static notFound(code = 'not_found', message = 'Not Found') {
    return new HttpError(404, code, message);
  }

  static conflict(code: string, message: string) {
    return new HttpError(409, code, message);
  }

  static tooManyRequests(code = 'rate_limited', message = 'Too Many Requests') {
    return new HttpError(429, code, message);
  }
}
