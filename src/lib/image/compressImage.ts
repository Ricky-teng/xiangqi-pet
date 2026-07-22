/**
 * src/lib/image/compressImage.ts
 *
 * 瀏覽器端圖片壓縮工具（給公告附圖用，見 @/types/database.ts 的
 * AnnouncementDoc 說明：這個專案沒有設定 Firebase Storage，圖片直接
 * 壓縮成小尺寸 JPEG、轉成 base64 存進 Firestore 文件本身）。
 * ------------------------------------------------------------
 * 用 <canvas> 把圖片等比例縮到最大邊長 maxDimension，再用
 * canvas.toDataURL 輸出 JPEG，quality 從 0.8 開始，如果檔案還是太大
 * 就逐步降低 quality 重新輸出，直到小於 maxBytes 或 quality 已經降到
 * 底為止。
 */

const DEFAULT_MAX_DIMENSION = 1200;
const DEFAULT_MAX_BYTES = 500 * 1024; // 500KB，留給 Firestore 1MiB 文件上限足夠的緩衝
const MIN_QUALITY = 0.4;

/**
 * 把使用者選的圖片檔案壓縮成 base64 JPEG data URL。
 * 失敗（不是圖片、瀏覽器不支援等）會 reject，呼叫端要自己 try/catch。
 */
export function compressImageToDataUrl(
  file: File,
  options?: { maxDimension?: number; maxBytes?: number }
): Promise<string> {
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("選擇的檔案不是圖片。"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("讀取圖片檔案失敗。"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("圖片解析失敗，請換一張圖片試試。"));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("瀏覽器不支援圖片壓縮所需的功能（canvas 2d context）。"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);

          // 從品質 0.8 開始，太大就逐步降到 MIN_QUALITY，
          // 每次降 0.1，避免無限迴圈
          let quality = 0.8;
          let dataUrl = canvas.toDataURL("image/jpeg", quality);
          while (dataUrl.length * 0.75 > maxBytes && quality > MIN_QUALITY) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }

          resolve(dataUrl);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("圖片壓縮時發生未知錯誤。"));
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
