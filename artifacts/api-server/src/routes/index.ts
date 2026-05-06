import { Router, type IRouter } from "express";
import healthRouter from "./health";
import exportRouter from "./export";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/export", exportRouter);

export default router;
