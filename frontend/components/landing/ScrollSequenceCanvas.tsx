'use client';

import React, { useRef, useEffect, useState } from 'react';

interface ScrollSequenceCanvasProps {
  progress: number;
  frameCount: number;
  framePrefix: string;
  framePath: string;
}

export default function ScrollSequenceCanvas({
  progress,
  frameCount,
  framePrefix,
  framePath
}: ScrollSequenceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadPercent, setLoadPercent] = useState(0);

  // Preload images
  useEffect(() => {
    let loadedCount = 0;
    const imgs: HTMLImageElement[] = [];
    
    // Safety check - don't reload if already loaded
    if (imagesRef.current.length === frameCount) return;
    
    // Optimization: Progressive loading instead of requesting 210 images at once
    const loadImages = async () => {
      for (let i = 0; i < frameCount; i++) {
        const img = new window.Image();
        const frameNum = String(i + 1).padStart(3, '0');
        img.src = `${framePath}/${framePrefix}${frameNum}.jpg`;
        imgs.push(img);

        // We don't await the image load, just attach listeners
        img.onload = () => {
          loadedCount++;
          setLoadPercent(Math.round((loadedCount / frameCount) * 100));
          if (loadedCount === frameCount) {
            setLoaded(true);
          }
        };
        img.onerror = () => {
          loadedCount++;
          setLoadPercent(Math.round((loadedCount / frameCount) * 100));
          if (loadedCount === frameCount) {
            setLoaded(true);
          }
        };
      }
      imagesRef.current = imgs;
      
      // We consider it "ready to start showing" at 30% loaded
      const checkInterval = setInterval(() => {
        if (loadedCount > frameCount * 0.3) {
          setLoaded(true);
          clearInterval(checkInterval);
        }
      }, 500);
    };

    loadImages();
  }, [frameCount, framePath, framePrefix]);

  // Render loop
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastRenderedProgress = -1;

    const renderFrame = () => {
      // Avoid re-rendering if progress hasn't changed
      if (progress === lastRenderedProgress) {
        animationFrameId = requestAnimationFrame(renderFrame);
        return;
      }
      
      const frameIndex = Math.min(
        frameCount - 1,
        Math.floor(progress * frameCount)
      );
      
      const img = imagesRef.current[frameIndex];
      if (!img || !img.complete || img.naturalWidth === 0) {
        // Image not loaded yet, skip this frame
        animationFrameId = requestAnimationFrame(renderFrame);
        return;
      }

      // Update resolution
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const displayWidth = Math.round(rect.width * dpr);
      const displayHeight = Math.round(rect.height * dpr);

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }

      // Draw image covering the whole canvas (object-fit: cover math)
      const canvasRatio = canvas.width / canvas.height;
      const imgRatio = img.width / img.height;
      
      let renderWidth, renderHeight, xOffset, yOffset;

      if (canvasRatio > imgRatio) {
        renderWidth = canvas.width;
        renderHeight = canvas.width / imgRatio;
        xOffset = 0;
        yOffset = (canvas.height - renderHeight) / 2;
      } else {
        renderWidth = canvas.height * imgRatio;
        renderHeight = canvas.height;
        xOffset = (canvas.width - renderWidth) / 2;
        yOffset = 0;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Optional: Add global composite operation for cinematic darkening if preferred
      ctx.drawImage(img, xOffset, yOffset, renderWidth, renderHeight);
      
      lastRenderedProgress = progress;
      animationFrameId = requestAnimationFrame(renderFrame);
    };

    renderFrame();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [progress, loaded, frameCount]);

  return (
    <div className="absolute inset-0 w-full h-full bg-black">
      <canvas 
        ref={canvasRef} 
        className="w-full h-full block" 
      />
      {!loaded && (
         <div className="absolute inset-0 bg-black flex flex-col items-center justify-center z-10 transition-opacity duration-500">
            <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden mb-4">
              <div 
                className="h-full bg-white transition-all duration-300" 
                style={{ width: `${loadPercent}%` }} 
              />
            </div>
            <div className="text-white/50 text-xs tracking-[0.2em] uppercase">Loading Cinematic Experience</div>
         </div>
      )}
    </div>
  );
}
