import { config } from "dotenv";
import cors from "cors";
import express from "express";
import router from "./routes/route.js";

config();

const PORT = Number(process.env.PORT || 5000);

const app = express();

app.use(
  cors({
    origin: true,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/", router);

app.listen(PORT, () => {
  console.log(`Local outreach backend running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/auth to connect Gmail once.`);
});
