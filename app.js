const path = require("path");
const cors = require("cors");
const multer = require("multer");
const express = require("express");
const COS = require("cos-nodejs-sdk-v5");
const { unzip } = require("fflate");
const { promises: fs } = require("fs");
const { v4: uuid } = require("uuid");

const app = express();
app.use(cors()); // 使用默认配置启用CORS

const upload = multer({ dest: "uploads/" }); // 设置文件存储位置

const cos = new COS({
  SecretId: process.env.SecretId,
  SecretKey: process.env.SecretKey,
});
// 存储桶名称，由bucketname-appid 组成，appid必须填入，可以在COS控制台查看存储桶名称。 https://console.cloud.tencent.com/cos5/bucket
const Bucket = "notion-nice-1253546688";
// 存储桶Region可以在COS控制台指定存储桶的概览页查看 https://console.cloud.tencent.com/cos5/bucket/
// 关于地域的详情见 https://cloud.tencent.com/document/product/436/6224
const Region = "ap-guangzhou";

// Routes
app.get(`/`, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/404", (req, res) => {
  res.status(404).send("Not found");
});

app.get("/500", (req, res) => {
  res.status(500).send("Server Error");
});

app.post("/api/converter", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const directoryName = req.body.filename || uuid();
    if (!file) {
      return res.status(400).send({ msg: "file 不存在" });
    }

    const arrayBuffer = await file.arrayBuffer();
    const zipData = new Uint8Array(arrayBuffer);
    const outputPath = path.join("/tmp", directoryName);

    await fs.mkdir(outputPath, { recursive: true });

    const mdFilePath = await saveFilesFromZip(zipData, outputPath);

    return res.status(200).send({ url: mdFilePath });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ msg: error.mmessage || "未知错误" });
  }
});

// Error handler
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).send("Internal Serverless Error");
});

// Web 类型云函数，只能监听 9000 端口
app.listen(9000, () => {
  console.log(`Server start on http://localhost:9000`);
});

/**
 * 将 fflate 的 unzip 方法转换为可以使用 Promise 的函数
 *
 * @param {Uint8Array} input
 * @returns {Promise<{ [filename: string]: Uint8Array }>}
 */
const asyncUnzip = (input) =>
  new Promise((resolve, reject) => {
    unzip(input, (error, unzipped) => {
      if (error) return reject(error);
      resolve(unzipped);
    });
  });

/**
 *
 * @param {Uint8Array} buffer
 * @param {string} outputPath
 * @returns {Promise<string>}
 */
async function saveFilesFromZip(buffer, outputPath) {
  // 确保输出路径存在
  await fs.mkdir(outputPath, { recursive: true });

  // 解压缩 Buffer
  const unzipped = await asyncUnzip(buffer);

  /** @type {string}  */
  let mdFilePath;

  for (const filename in unzipped) {
    const fileContent = unzipped[filename];
    const filePath = path.join(outputPath, filename);

    // 确保文件路径中的目录存在
    const directoryPath = path.dirname(filePath);
    await fs.mkdir(directoryPath, { recursive: true });

    // 保存文件到磁盘
    await fs.writeFile(filePath, fileContent);

    const ret = await cos.sliceUploadFile({
      Bucket: Bucket,
      Region: Region,
      Key: filePath,
      FilePath: filePath,
    });
    if (filename.endsWith(".md")) {
      // 如果是 Markdown 文件，记录其路径
      mdFilePath = ret.Location;
    }
  }

  await fs.rm(outputPath, { recursive: true, force: true });

  if (!mdFilePath) {
    throw new Error("Markdown file not found in the ZIP archive");
  }

  return mdFilePath;
}
