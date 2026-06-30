import { loadConfig } from "./config.js";
import { assertValidConfig } from "./configValidation.js";
import { startApp } from "./app.js";

process.on("unhandledRejection", (reason) => {
  console.error("未处理的异步错误：", reason);
});

process.on("uncaughtException", (error) => {
  console.error("未捕获异常：", error);
  process.exitCode = 1;
});

const config = loadConfig();
assertValidConfig(config);
await startApp(config);
