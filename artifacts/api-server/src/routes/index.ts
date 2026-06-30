import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import consentsRouter from "./consents";
import invitesRouter from "./invites";
import whatsappRouter from "./whatsapp";
import locationRouter from "./location";
import pushRouter from "./push-notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(consentsRouter);
router.use(invitesRouter);
router.use(whatsappRouter);
router.use(locationRouter);
router.use(pushRouter);

export default router;
