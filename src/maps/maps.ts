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
const riversShpFile =
  "ne_10m_rivers_lake_centerlines/ne_10m_rivers_lake_centerlines.shp";
const cropByWindowShpFile = "ne_10m_admin_0_countries/cropByWindow.shp";
const cropByCutlineShpFile = "ne_10m_admin_0_countries/cropByCutline.shp";
const cropRiversByCutlineShpFile =
  "ne_10m_rivers_lake_centerlines/cropRiversByCutline.shp";
const geoJsonFile = "ne_10m_admin_0_countries/geo.json";
const geoJsonRiversFile = "ne_10m_rivers_lake_centerlines/geo.json";
const orgTifFile = "ETOPO1_Ice_g_geotiff.tif";
const translatedTifFile = "ETOPO1.tif";
const mercatorTifFile = "mercator.tif";
const colorMapFile = "colormap.txt";
const cropByCutlineTifFile = "cropByCutline.tif";
const cropByWindowTifFile = "cropByWindow.tif";
const shadedTifFile = "shadedrelief.tif";
const shadedPngFile = "shadedrelief.png";
const transparentPngFile = "transparent.png";
const transparentJpgFile = "transparent.jpg";
const finalPngFile = "final.png";
const finalTopoFile = "topo.json";
let finalWebpFile = "final.webp";
let topoJsonFile = "ne_10m_admin_0_countries/topo.json";
let topoJsonRiversFile = "ne_10m_rivers_lake_centerlines/rivers.json";

function clean(dataDir: string, finalPng: string, finalTopo: string) {
  return new Promise<void>((resolve, reject) => {
    console.log("\n== clean data folder");
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
    console.log("\n== setup folder");
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
    // execution.stdout.on("data", (data) => {
    //   console.log(`stdout: ${data}`);
    // });

    execution.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
    });

    execution.on("close", (code) => {
      // console.log(`child process exited with code ${code}`);
      if (code) {
        reject();
      } else {
        resolve();
      }
    });
  });
}

function copyFiles(dataDir: string, orgDir: string) {
  console.log("\n== copy files");
  return runExternal("cp", ["-a", `${orgDir}/.`, `${dataDir}/`]);
}

function cropByCutlineShp(
  fileNameBefore: string,
  fileNameAfter: string,
  continentsInput: Country[],
  countriesInput: Country[]
) {
  console.log("\n== crop by cutline");
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
  console.log("\n== crop by window");
  const { north, south, west, east } = coords;
  return runExternal("ogr2ogr", [
    "-clipsrc",
    west,
    north,
    east,
    south,
    "-simplify",
    "0.05",
    fileNameAfter,
    fileNameBefore,
  ]);
}

function addInfoToTif(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== add info");
  return runExternal("gdal_translate", [
    "-a_srs",
    "EPSG:4326",
    fileNameBefore,
    fileNameAfter,
    "-a_nodata",
    "0",
  ]);
}

function translateToMercator(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== translate to mercator");
  return runExternal("gdalwarp", [
    "-t_srs",
    "EPSG:3857",
    fileNameBefore,
    fileNameAfter,
  ]);
}

function cropByWindowTif(
  fileNameBefore: string,
  fileNameAfter: string,
  coords
) {
  console.log("\n== crop tif by window");
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
  console.log("\n== crop tif by cutline");
  return runExternal("gdalwarp", [
    "-cutline",
    cutlineFileName,
    "-crop_to_cutline",
    "-dstalpha",
    "-srcnodata",
    "255",
    "-dstnodata",
    "255",
    fileNameBefore,
    fileNameAfter,
  ]);
}

function shade(
  fileNameBefore: string,
  fileNameAfter: string,
  colorMap: string
) {
  // return runExternal("gdaldem", [
  //   "color-relief",
  //   fileNameBefore,
  //   colorMap,
  //   fileNameAfter,
  //   "-alpha",
  // ]);
  console.log("\n== add hillshade");
  return runExternal("gdaldem", [
    "hillshade",
    fileNameBefore,
    fileNameAfter,
    "-z",
    "45",
    // "-alpha",
    "-compute_edges",
  ]);
}

function toPng(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== convert to png");
  return runExternal("gdal_translate", [
    "-geometry",
    "-of",
    "PNG",
    fileNameBefore,
    fileNameAfter,
  ]);
  // return runExternal("convert", [
  //   fileNameBefore,
  //   "-resize",
  //   PNG_WIDTH,
  //   fileNameAfter,
  // ]);
}

function toTransparent(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== make transparent");
  // return runExternal("gdal_calc.py", [
  //   "-A",
  //   fileNameBefore,
  //   `--outfile=${fileNameAfter}`,
  //   '--calc="255*(A>220) + A*(A<=220)"',
  // ]);

  //  \
  // 	-A tmp/hillshade.tmp.tif \
  // 	--outfile=$@ \
  //   --calc="255*(A>220) + A*(A<=220)"

  // return runExternal("convert", [
  //   fileNameBefore,
  //   "-fuzz",
  //   "7%",
  //   "-fill",
  //   "#FFFFFF",
  //   "-opaque",
  //   "#DDDDDD",
  //   fileNameAfter,
  // ]);

  return runExternal("convert", [
    fileNameBefore,
    "-resize",
    "30%",
    "-trim",
    "+repage",
    "-fuzz",
    "6%",
    "-transparent",
    "#b5b5b5",
    fileNameAfter,
  ]);
}

function toFinal(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== convert to webp");

  return runExternal("magick", [
    fileNameBefore,
    "-quality",
    "20",
    "-strip",
    "-define",
    "webp:target-size=200000",
    // "-define",
    // "webp:lossless=true",
    fileNameAfter,
  ]);

  // return runExternal("convert", [
  //   fileNameBefore,
  //   "-alpha",
  //   "copy",
  //   "-channel",
  //   "alpha",
  //   "-negate",
  //   "+channel",
  //   fileNameAfter,
  // ]);
}

function toGeoJson(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== convert to geojson");
  return runExternal("ogr2ogr", [
    "-f",
    "GeoJSON",
    fileNameAfter,
    fileNameBefore,
  ]);
}

function toTopoJson(fileNameBefore: string, fileNameAfter: string) {
  console.log("\n== convert to topojson");
  return new Promise<void>((resolve, reject) => {
    const logStream = fs.createWriteStream(fileNameAfter, { flags: "a" });
    const execution = spawn("geo2topo", [`geo=${fileNameBefore}`]);

    execution.stdout.pipe(logStream);
    execution.stderr.pipe(logStream);

    execution.on("close", (code) => {
      // console.log(`child process exited with code ${code}`);
      if (code) {
        reject();
      } else {
        fs.readFile(`${fileNameAfter}`, "utf8", function (err, data) {
          if (err) {
            resolve();
            return;
          }

          const o = JSON.parse(data);
          o.objects.geo.geometries.forEach((element) => {
            const copy: { [key: string]: string } = {};
            // console.log("element.properties", element.properties);

            const name = element.properties.NAME || element.properties.name;
            copy.sov = element.properties.SOV_A3;
            copy.id = `${name}_${element.properties.SOV_A3}`;
            copy.name = name;
            element.properties = copy;
          });

          fs.writeFile(
            fileNameAfter,
            JSON.stringify(o),
            { encoding: "utf8", flag: "w" },
            (err) => {
              if (err) {
                console.error(err);
              }
              resolve();
            }
          );
        });
      }
    });
  });
}

function copyToPublic(
  publicDir: string,
  finalWebp: string,
  finalTopo: string,
  riversTopo: string
) {
  console.log("\n== copy to public");
  return Promise.all([
    runExternal("cp", [finalWebp, publicDir]),
    runExternal("cp", [finalTopo, publicDir]),
    runExternal("cp", [riversTopo, publicDir]),
  ]);
}

module.exports = function (app) {
  // app.get("/maps/topo.json", (req, res) => {
  //   console.log("topo");
  //   const appDir = path.dirname(require.main.filename);
  //   const dataDir = `${appDir}/data`;
  //   fs.readFile(`${dataDir}/${topoJsonFile}`, "utf8", function (err, data) {
  //     if (err) {
  //       res.status(500).send(err);
  //       return;
  //     }
  //     res.json(JSON.parse(data));
  //   });
  // });

  // app.get("/maps/rivers.json", (req, res) => {
  //   console.log("rivers");
  //   const appDir = path.dirname(require.main.filename);
  //   const dataDir = `${appDir}/data`;
  //   fs.readFile(
  //     `${dataDir}/${topoJsonRiversFile}`,
  //     "utf8",
  //     function (err, data) {
  //       if (err) {
  //         res.status(500).send(err);
  //         return;
  //       }
  //       res.json(JSON.parse(data));
  //     }
  //   );
  // });

  app.post("/maps/countries", (req, res) => {
    (async function () {
      try {
        const appDir = path.dirname(require.main.filename);
        const dataDir = `${appDir}/data`;
        const orgDir = `${appDir}/original`;
        const publicDir = `${appDir}/../public`;
        const { north, south, west, east } = req.body;
        const coords = `${north}_${west}_${east}_${south}`;
        finalWebpFile = `final_${coords}.webp`;
        topoJsonFile = `ne_10m_admin_0_countries/land_${coords}.json`;
        topoJsonRiversFile = `ne_10m_rivers_lake_centerlines/rivers_${coords}.json`;

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
              `${dataDir}/${riversShpFile}`,
              `${dataDir}/${cropRiversByCutlineShpFile}`,
              { ...req.body }
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
            translateToMercator(
              `${dataDir}/${cropByWindowTifFile}`,
              `${dataDir}/${mercatorTifFile}`
            )
          )
          .then(() =>
            shade(
              `${dataDir}/${mercatorTifFile}`,
              `${dataDir}/${shadedTifFile}`,
              `${dataDir}/${colorMapFile}`
            )
          )
          .then(() =>
            toTransparent(
              `${dataDir}/${shadedTifFile}`,
              `${dataDir}/${finalPngFile}`
            )
          )
          .then(() =>
            toFinal(`${dataDir}/${finalPngFile}`, `${dataDir}/${finalWebpFile}`)
          )
          .then(() =>
            toGeoJson(
              `${dataDir}/${cropRiversByCutlineShpFile}`,
              `${dataDir}/${geoJsonRiversFile}`
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
              `${dataDir}/${geoJsonRiversFile}`,
              `${dataDir}/${topoJsonRiversFile}`
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
              `${dataDir}/${finalWebpFile}`,
              `${dataDir}/${topoJsonFile}`,
              `${dataDir}/${topoJsonRiversFile}`
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
