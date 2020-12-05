import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const PORT = 8080;
const app = express();
app.use(bodyParser.json());
app.use(cors({ credentials: true, origin: true }));
app.use(express.static("public"));

require("./maps/maps")(app);

app.listen(PORT, () => {
  console.log(`Server is running in http://localhost:${PORT}`);
});
