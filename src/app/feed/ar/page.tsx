/**
 * src/app/feed/ar/page.tsx
 *
 * AR 拍照模式（仿 Pokemon GO 的「相機疊圖」拍照，不是真正的空間
 * 定位 AR——網頁做不到 ARKit/ARCore 那種貼合地板/牆壁的追蹤，iPhone
 * Safari 對 WebXR 支援也很不穩定，所以改用比較務實可行的做法）：
 *   1. 開手機相機（優先用後鏡頭 facingMode: "environment"）當背景。
 *   2. 小雞圖案疊在畫面上，可以用手指拖曳調整位置、按鈕調整大小。
 *   3. 快門：把「目前相機畫面 + 小雞疊圖」合成到一張 canvas，變成
 *      一張靜態圖片，可以存到裝置或用系統分享功能分享出去。
 *
 * 相機權限被拒絕、或裝置沒有相機（例如桌機沒接鏡頭）都會顯示友善的
 * 錯誤畫面，不會讓頁面直接壞掉。離開頁面（unmount）一定要停止所有
 * 相機串流的 track，不然鏡頭指示燈會一直亮著。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { getPetDisplaySrc, getPetImagePath } from "@/lib/pet/petImagePath";

type CameraStatus = "requesting" | "denied" | "unavailable" | "ready";

const OVERLAY_SIZE_MIN = 0.5;
const OVERLAY_SIZE_MAX = 2;
const OVERLAY_SIZE_STEP = 0.15;

function ArCameraContent() {
  const router = useRouter();
  const pet = useGameStore((s) => s.pet);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>("requesting");
  const [overlayPos, setOverlayPos] = useState({ xPercent: 50, yPercent: 58 });
  const [overlayScale, setOverlayScale] = useState(1);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [jobImageFailed, setJobImageFailed] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const petDisplay = pet ? getPetDisplaySrc(pet.stage, pet.healthStatus, pet.currentAppearanceId) : null;
  const petImageSrc =
    pet && petDisplay
      ? petDisplay.isJobImage && jobImageFailed
        ? getPetImagePath(pet.stage, pet.healthStatus)
        : petDisplay.src
      : null;

  // ---- 啟動相機：優先後鏡頭，離開頁面一定要停止所有 track ----
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("ready");
      } catch (error) {
        console.error("[feed/ar] 開啟相機失敗：", error);
        if (!cancelled) setStatus("denied");
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // ---- 拖曳小雞疊圖：用百分比座標，跟畫面尺寸無關，方便合成到 canvas 時換算 ----
  useEffect(() => {
    if (!isDraggingOverlay) return;

    function toPercent(clientX: number, clientY: number) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        xPercent: Math.min(95, Math.max(5, ((clientX - rect.left) / rect.width) * 100)),
        yPercent: Math.min(95, Math.max(5, ((clientY - rect.top) / rect.height) * 100)),
      };
    }

    function onMove(e: PointerEvent) {
      const next = toPercent(e.clientX, e.clientY);
      if (next) setOverlayPos(next);
    }
    function onUp() {
      setIsDraggingOverlay(false);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDraggingOverlay]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (!petImageSrc) {
      setCapturedImage(canvas.toDataURL("image/png"));
      return;
    }

    const petImg = new Image();
    petImg.onload = () => {
      // 疊圖大小用畫面較短邊的比例當基準，overlayScale 是使用者用
      // +/- 按鈕調整的倍率，跟拖曳位置一樣換算成 canvas 實際像素。
      const baseSize = Math.min(canvas.width, canvas.height) * 0.45 * overlayScale;
      const aspectRatio = petImg.naturalWidth / petImg.naturalHeight || 1;
      const drawWidth = baseSize;
      const drawHeight = baseSize / aspectRatio;
      const centerX = (overlayPos.xPercent / 100) * canvas.width;
      const centerY = (overlayPos.yPercent / 100) * canvas.height;
      ctx.drawImage(petImg, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
      setCapturedImage(canvas.toDataURL("image/png"));
    };
    petImg.onerror = () => {
      // 疊圖圖檔萬一載入失敗，還是把純相機畫面存起來，不要整張拍照失敗
      setCapturedImage(canvas.toDataURL("image/png"));
    };
    petImg.src = petImageSrc;
  }

  function handleDownload() {
    if (!capturedImage) return;
    const a = document.createElement("a");
    a.href = capturedImage;
    a.download = `xiangqi-pet-ar-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleShare() {
    if (!capturedImage) return;
    try {
      const res = await fetch(capturedImage);
      const blob = await res.blob();
      const file = new File([blob], "xiangqi-pet-ar.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "我的象棋小雞" });
        return;
      }
    } catch (error) {
      // 使用者按了分享面板的「取消」也會跑進這裡（AbortError），
      // 這種情況不算失敗，靜默處理就好，不用跳錯誤訊息嚇到人。
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("[feed/ar] 分享失敗，改用下載：", error);
    }
    handleDownload();
    setShareMessage("這個裝置不支援直接分享，已經改用下載。");
    setTimeout(() => setShareMessage(null), 3000);
  }

  function handleRetake() {
    setCapturedImage(null);
  }

  return (
    <main className="fixed inset-0 flex flex-col bg-black">
      <header className="z-10 flex shrink-0 items-center justify-between bg-black/40 px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/feed")}
          className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold text-white transition-transform active:scale-95"
        >
          ← 返回
        </button>
        <h1 className="text-sm font-bold text-white">📷 AR 拍照</h1>
        <span className="w-[68px]" aria-hidden="true" />
      </header>

      {status === "requesting" ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-white/70">正在開啟相機…</p>
        </div>
      ) : status === "denied" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-3xl">🚫📷</p>
          <p className="text-sm text-white/80">
            沒有取得相機權限，沒辦法使用 AR 拍照。請到瀏覽器設定允許相機權限後再回來試試看。
          </p>
        </div>
      ) : status === "unavailable" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-3xl">🖥️🚫</p>
          <p className="text-sm text-white/80">這個裝置或瀏覽器不支援相機功能，沒辦法使用 AR 拍照。</p>
        </div>
      ) : capturedImage ? (
        <>
          <div className="flex flex-1 items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capturedImage} alt="AR 合成照片" className="max-h-full max-w-full object-contain" />
          </div>
          {shareMessage ? (
            <p className="px-4 pb-1 text-center text-xs text-white/70">{shareMessage}</p>
          ) : null}
          <div className="z-10 flex shrink-0 items-center justify-center gap-3 bg-black/40 px-4 py-4">
            <button
              type="button"
              onClick={handleRetake}
              className="rounded-2xl bg-white/20 px-4 py-2.5 text-sm font-bold text-white transition-transform active:scale-95"
            >
              🔄 重拍
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-2xl bg-white/20 px-4 py-2.5 text-sm font-bold text-white transition-transform active:scale-95"
            >
              💾 存到裝置
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="rounded-2xl bg-[#E8B84B] px-4 py-2.5 text-sm font-bold text-[#5C3D0A] transition-transform active:scale-95"
            >
              📤 分享
            </button>
          </div>
        </>
      ) : (
        <>
          <div ref={containerRef} className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />

            {petImageSrc ? (
              <img
                src={petImageSrc}
                alt="小雞疊圖"
                onError={() => {
                  if (petDisplay?.isJobImage && !jobImageFailed) setJobImageFailed(true);
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setIsDraggingOverlay(true);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none select-none object-contain drop-shadow-2xl active:cursor-grabbing"
                style={{
                  left: `${overlayPos.xPercent}%`,
                  top: `${overlayPos.yPercent}%`,
                  width: `${45 * overlayScale}vw`,
                  maxWidth: "70vw",
                }}
                draggable={false}
              />
            ) : null}

            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-[11px] font-bold text-white">
              拖曳小雞可以調整位置
            </p>
          </div>

          <div className="z-10 flex shrink-0 items-center justify-between gap-3 bg-black/40 px-6 py-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOverlayScale((s) => Math.max(OVERLAY_SIZE_MIN, s - OVERLAY_SIZE_STEP))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg font-bold text-white active:scale-90"
              >
                −
              </button>
              <span className="text-xs text-white/60">大小</span>
              <button
                type="button"
                onClick={() => setOverlayScale((s) => Math.min(OVERLAY_SIZE_MAX, s + OVERLAY_SIZE_STEP))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg font-bold text-white active:scale-90"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleCapture}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/30 text-2xl transition-transform active:scale-90"
              aria-label="拍照"
            >
              📸
            </button>

            <span className="w-[86px]" aria-hidden="true" />
          </div>
        </>
      )}
    </main>
  );
}

export default function ArCameraPage() {
  return (
    <RequireAuth requiredRole="student">
      <ArCameraContent />
    </RequireAuth>
  );
}
