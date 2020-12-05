import { resolveSoa } from "dns";

interface Country {
  name: string;
  code: string;
  continent: string;
  isContinent?: boolean;
}

const countries: Country[] = require("./countries.json");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const geostitch = require("d3-geo-projection").geoStitch;
const topojson = require("topojson-server");

const continents = {
  Europe: 0,
  Asia: 1,
  "North America": 2,
  "South America": 3,
  Africa: 4,
  Oceania: 5,
};

const orgShpFile = "ne_10m_admin_0_countries/ne_10m_admin_0_countries.shp";
const cropByWindowShpFile = "ne_10m_admin_0_countries/cropByWindow.shp";
const cropByCutlineShpFile = "ne_10m_admin_0_countries/cropByCutline.shp";
const geoJsonFile = "ne_10m_admin_0_countries/geo.json";
const topoJsonFile = "ne_10m_admin_0_countries/topo.json";
const orgTifFile = "ETOPO1_Ice_g_geotiff.tif";
const translatedTifFile = "ETOPO1.tif";
const cropByCutlineTifFile = "cropByCutline.tif";
const cropByWindowTifFile = "cropByWindow.tif";
const shadedTifFile = "shadedrelief.tif";
const shadedPngFile = "shadedrelief.png";
const transparentPngFile = "transparent.png";
const finalPngFile = "final.png";
const finalTopoFile = "topo.json";

const PNG_WIDTH = "2400";

function clean(dataDir: string, finalPng: string, finalTopo: string) {
  return new Promise<void>((resolve, reject) => {
    console.log("clean data folder");
    fs.rmdir(dataDir, { recursive: true }, (err) => {
      if (err) {
        reject(err);
        return;
      }

      fs.unlink(finalPng, function (pngErr) {
        if (pngErr && pngErr.code !== "ENOENT") {
          reject();
          return;
        }
        fs.unlink(finalTopo, function (topoErr) {
          if (topoErr && topoErr.code === "ENOENT") {
            resolve();
            return;
          } else if (err) {
            reject();
            return;
          }
          resolve();
        });
      });
    });
  });
}

function setupDir(dataDir: string, orgDir: string) {
  return new Promise<void>((resolve, reject) => {
    console.log("setup data folder");
    fs.mkdir(dataDir, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function runExternal(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const execution = spawn(cmd, args);
    execution.stdout.on("data", (data) => {
      console.log(`stdout: ${data}`);
    });

    execution.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
    });

    execution.on("close", (code) => {
      console.log(`child process exited with code ${code}`);
      if (code) {
        reject();
      } else {
        resolve();
      }
    });
  });
}

function copyFiles(dataDir: string, orgDir: string) {
  return runExternal("cp", ["-a", `${orgDir}/.`, `${dataDir}/`]);
}

function cropByCutlineShp(
  fileNameBefore: string,
  fileNameAfter: string,
  continentsInput: Country[],
  countriesInput: Country[]
) {
  const filter = countriesInput.map((item) => `'${item.code}'`);
  const countriesFromContinents = [];
  const continentsMap = {};
  continentsInput.forEach(
    (continent) => (continentsMap[continent.continent] = true)
  );
  countries.forEach((elem) => {
    if (continentsMap[elem.continent]) {
      countriesFromContinents.push(`'${elem.code}'`);
    }
  });

  const sql = `adm0_a3 IN (${[...filter, ...countriesFromContinents].join(
    ","
  )})`;

  return runExternal("ogr2ogr", [
    "-where",
    sql,
    "-lco",
    "ENCODING=UTF-8",
    fileNameAfter,
    fileNameBefore,
  ]);
}

function cropByWindowShp(
  fileNameBefore: string,
  fileNameAfter: string,
  coords
) {
  const { north, south, west, east } = coords;
  return runExternal("ogr2ogr", [
    "-clipsrc",
    west,
    north,
    east,
    south,
    fileNameAfter,
    fileNameBefore,
  ]);
}

function addInfoToTif(fileNameBefore: string, fileNameAfter: string) {
  return runExternal("gdal_translate", [
    "-a_srs",
    "EPSG:4326",
    fileNameBefore,
    fileNameAfter,
    "-a_nodata",
    "0",
  ]);
}

function cropByWindowTif(
  fileNameBefore: string,
  fileNameAfter: string,
  coords
) {
  const { north, south, west, east } = coords;
  return runExternal("gdal_translate", [
    "-projwin",
    west,
    north,
    east,
    south,
    fileNameBefore,
    fileNameAfter,
    "-a_nodata",
    "0",
  ]);
}

function cropByCutlineTif(
  fileNameBefore: string,
  fileNameAfter: string,
  cutlineFileName: string
) {
  return runExternal("gdalwarp", [
    "-cutline",
    cutlineFileName,
    "-crop_to_cutline",
    "-dstalpha",
    fileNameBefore,
    fileNameAfter,
  ]);
}

function shade(fileNameBefore: string, fileNameAfter: string) {
  return runExternal("gdaldem", [
    "hillshade",
    fileNameBefore,
    fileNameAfter,
    "-z",
    "5",
    "-s",
    "111120",
    "-az",
    "315",
    "-alt",
    "60",
  ]);
}

function toPng(fileNameBefore: string, fileNameAfter: string) {
  return runExternal("convert", [
    fileNameBefore,
    "-resize",
    PNG_WIDTH,
    fileNameAfter,
  ]);
}

function toTransparent(fileNameBefore: string, fileNameAfter: string) {
  return runExternal("convert", [
    fileNameBefore,
    "-fuzz",
    "7%",
    "-transparent",
    "#DDDDDD",
    fileNameAfter,
  ]);
}

function toFinal(fileNameBefore: string, fileNameAfter: string) {
  return runExternal("convert", [
    fileNameBefore,
    "-alpha",
    "copy",
    "-channel",
    "alpha",
    "-negate",
    "+channel",
    fileNameAfter,
  ]);
}

function toGeoJson(fileNameBefore: string, fileNameAfter: string) {
  return runExternal("ogr2ogr", [
    "-f",
    "GeoJSON",
    fileNameAfter,
    fileNameBefore,
  ]);
}

function toTopoJson(fileNameBefore: string, fileNameAfter: string) {
  return new Promise<void>((resolve, reject) => {
    const logStream = fs.createWriteStream(fileNameAfter, { flags: "a" });
    const execution = spawn("geo2topo", [fileNameBefore]);

    execution.stdout.pipe(logStream);
    execution.stderr.pipe(logStream);

    execution.on("close", (code) => {
      console.log(`child process exited with code ${code}`);
      if (code) {
        reject();
      } else {
        resolve();
      }
    });
  });
}

function copyToPublic(publicDir: string, finalPng: string, finalTopo: string) {
  return Promise.all([
    runExternal("cp", [finalPng, publicDir]),
    runExternal("cp", [finalTopo, publicDir]),
  ]);
}

module.exports = function (app) {
  app.get("/maps/topo.json", (req, res) => {
    const appDir = path.dirname(require.main.filename);
    const dataDir = `${appDir}/data`;
    fs.readFile(`${dataDir}/${topoJsonFile}`, "utf8", function (err, data) {
      if (err) {
        res.status(500).send(err);
        return;
      }
      res.json(JSON.parse(data));
    });
  });

  app.post("/maps/countries", (req, res) => {
    console.log("req.body", req.body);
    (async function () {
      try {
        const appDir = path.dirname(require.main.filename);
        const dataDir = `${appDir}/data`;
        const orgDir = `${appDir}/original`;
        const publicDir = `${appDir}/../public`;

        clean(
          dataDir,
          `${publicDir}/${finalPngFile}`,
          `${publicDir}/${finalTopoFile}`
        )
          .then(() => setupDir(dataDir, orgDir))
          .then(() => copyFiles(dataDir, orgDir))
          .then(() =>
            cropByCutlineShp(
              `${dataDir}/${orgShpFile}`,
              `${dataDir}/${cropByCutlineShpFile}`,
              req.body.continents,
              req.body.countries
            )
          )
          .then(() =>
            cropByWindowShp(
              `${dataDir}/${cropByCutlineShpFile}`,
              `${dataDir}/${cropByWindowShpFile}`,
              { ...req.body }
            )
          )
          .then(() =>
            addInfoToTif(
              `${dataDir}/${orgTifFile}`,
              `${dataDir}/${translatedTifFile}`
            )
          )
          .then(() =>
            cropByCutlineTif(
              `${dataDir}/${translatedTifFile}`,
              `${dataDir}/${cropByCutlineTifFile}`,
              `${dataDir}/${cropByWindowShpFile}`
            )
          )
          .then(() =>
            cropByWindowTif(
              `${dataDir}/${cropByCutlineTifFile}`,
              `${dataDir}/${cropByWindowTifFile}`,
              { ...req.body }
            )
          )
          .then(() =>
            shade(
              `${dataDir}/${cropByWindowTifFile}`,
              `${dataDir}/${shadedTifFile}`
            )
          )
          .then(() =>
            toPng(`${dataDir}/${shadedTifFile}`, `${dataDir}/${shadedPngFile}`)
          )
          .then(() =>
            toTransparent(
              `${dataDir}/${shadedPngFile}`,
              `${dataDir}/${transparentPngFile}`
            )
          )
          .then(() =>
            toFinal(
              `${dataDir}/${transparentPngFile}`,
              `${dataDir}/${finalPngFile}`
            )
          )
          .then(() =>
            toGeoJson(
              `${dataDir}/${cropByWindowShpFile}`,
              `${dataDir}/${geoJsonFile}`
            )
          )
          .then(() =>
            toTopoJson(
              `${dataDir}/${geoJsonFile}`,
              `${dataDir}/${topoJsonFile}`
            )
          )
          .then(() =>
            copyToPublic(
              publicDir,
              `${dataDir}/${finalPngFile}`,
              `${dataDir}/${topoJsonFile}`
            )
          )
          .then(() =>
            res.send({
              topo: `${dataDir}/${topoJsonFile}`,
              image: `${dataDir}/${finalPngFile}`,
            })
          )
          .catch((err) => res.status(500).send(err));
      } catch (err) {
        console.log("POST: /maps/countries", err);
        res.sendStatus(500);
      }
    })();
  });

  app.get("/maps/countries", (req, res) => {
    // return res.sendStatus(500);
    // countries.sort((a: Country, b: Country) => {
    //   if (continents[a.continent] < continents[b.continent]) {
    //     return -1;
    //   }

    //   if (continents[a.continent] > continents[b.continent]) {
    //     return 1;
    //   }

    //   return a.name.localeCompare(b.name);
    // });

    res.json(countries);
  });
};
