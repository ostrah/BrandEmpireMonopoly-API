import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';
import { roomService } from '../services/room.service.js';
import { createRoomSchema, joinByCodeSchema } from '../schemas/room.schemas.js';

const rlCreate = rateLimit({ name: 'room_create', max: 10, windowMs: 60_000 });

export const roomsRouter = Router();

roomsRouter.get('/', async (_req, res, next) => {
  try {
    const rooms = await roomService.listPublic();
    res.json({ rooms });
  } catch (err) { next(err); }
});

// Static routes must come before /:id to avoid collision
roomsRouter.post(
  '/join',
  requireAuth,
  validateBody(joinByCodeSchema),
  async (req, res, next) => {
    try {
      const room = await roomService.join(req.body.code as string, req.user!.id);
      res.json({ room });
    } catch (err) { next(err); }
  }
);

roomsRouter.post(
  '/',
  requireAuth,
  rlCreate,
  validateBody(createRoomSchema),
  async (req, res, next) => {
    try {
      const room = await roomService.create(req.body, req.user!.id);
      res.status(201).json({ room });
    } catch (err) { next(err); }
  }
);

roomsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const room = await roomService.getById(req.params.id!, req.user!.id);
    res.json({ room });
  } catch (err) { next(err); }
});

roomsRouter.post('/:id/leave', requireAuth, async (req, res, next) => {
  try {
    await roomService.leave(req.params.id!, req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

roomsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await roomService.close(req.params.id!, req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});
