import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import consentsRouter from "./consents";
import invitesRouter from "./invites";
import whatsappRouter from "./whatsapp";
import locationRouter from "./location";
import pushRouter from "./push-notifications";
import geofencesRouter from "./geofences";
import notificationsRouter from "./notifications";
import sosRouter from "./sos";
import geoPhotosRouter from "./geo-photos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(consentsRouter);
router.use(invitesRouter);
router.use(whatsappRouter);
router.use(locationRouter);
router.use(pushRouter);
router.use(geofencesRouter);
router.use(notificationsRouter);
router.use(sosRouter);
router.use(geoPhotosRouter);

export default router;
