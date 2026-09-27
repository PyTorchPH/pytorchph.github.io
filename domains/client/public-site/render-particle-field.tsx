"use client";

import { useEffect, useRef } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
};

export function ParticleField({ className, density = 76 }: { className?: string; density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const currentCanvas = canvasRef.current;
    if (!currentCanvas) return;

    const currentContext = currentCanvas.getContext("2d");
    if (!currentContext) return;

    const canvasElement: HTMLCanvasElement = currentCanvas;
    const context: CanvasRenderingContext2D = currentContext;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;
    let pointerX = 0;
    let pointerY = 0;
    let particles: Particle[] = [];

    function resize() {
      const scale = window.devicePixelRatio || 1;
      width = canvasElement.clientWidth;
      height = canvasElement.clientHeight;
      canvasElement.width = Math.floor(width * scale);
      canvasElement.height = Math.floor(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      particles = Array.from({ length: density }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        z: 0.3 + Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45
      }));
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      const depthX = prefersReduced ? 0 : pointerX * 18;
      const depthY = prefersReduced ? 0 : pointerY * 18;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (!prefersReduced) {
          p.x += p.vx * p.z;
          p.y += p.vy * p.z;
        }
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        const px = p.x + depthX * p.z;
        const py = p.y + depthY * p.z;
        context.beginPath();
        context.arc(px, py, 1.4 + p.z * 1.4, 0, Math.PI * 2);
        context.fillStyle = `rgba(232, 89, 12, ${0.25 + p.z * 0.45})`;
        context.fill();

        for (let j = i + 1; j < particles.length; j += 1) {
          const q = particles[j];
          const qx = q.x + depthX * q.z;
          const qy = q.y + depthY * q.z;
          const distance = Math.hypot(px - qx, py - qy);
          if (distance < 105) {
            context.strokeStyle = `rgba(255, 255, 255, ${0.09 * (1 - distance / 105)})`;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(px, py);
            context.lineTo(qx, qy);
            context.stroke();
          }
        }
      }

      frame = requestAnimationFrame(draw);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvasElement.getBoundingClientRect();
      pointerX = (event.clientX - rect.left) / rect.width - 0.5;
      pointerY = (event.clientY - rect.top) / rect.height - 0.5;
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [density]);

  return (
    <canvas
      aria-hidden="true"
      className={cn("absolute inset-0 h-full w-full bg-[radial-gradient(circle_at_35%_20%,rgba(232,89,12,0.22),transparent_30%),#0B0B0C]", className)}
      ref={canvasRef}
    />
  );
}
