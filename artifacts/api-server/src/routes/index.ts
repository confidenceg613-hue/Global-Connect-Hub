import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import consentsRouter from "./consents";
import invitesRouter from "./invites";
import whatsappRouter from "./whatsapp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(consentsRouter);
router.use(invitesRouter);
router.use(whatsappRouter);

export default router;
