import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/engine-move": ["./vendor/pikafish/**"],
  },
  reactStrictMode: true,
  // firebase-admin 的依賴（jose/jwks-rsa）是 ESM 格式，如果被 Next.js
  // 打包進 serverless function 會跟 CommonJS require() 衝突，噴
  // "ERR_REQUIRE_ESM" 錯誤（/api/friends/accept、/api/battle/
  // challenge-respond 等所有用到 src/lib/server/firebaseAdmin.ts 的
  // API route 都會中招）。加進 serverExternalPackages 讓 Next.js
  // 不要打包它，執行時直接用 Node.js 原生 require 讀 node_modules，
  // 才不會有 ESM/CJS 打包衝突。
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;