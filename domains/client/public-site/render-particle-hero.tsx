"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

export function FigmaParticleHero() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);
    const mouse = { x: width / 2, y: height / 2 };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const count = Math.min(120, Math.floor((width * height) / 12000));
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.6 + 0.4
    }));

    const resize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };

    const move = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = event.clientX - rect.left;
      mouse.y = event.clientY - rect.top;
    };

    let frame = 0;
    const draw = () => {
      context.clearRect(0, 0, width, height);
      const gradient = context.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 260);
      gradient.addColorStop(0, "rgba(232,89,12,0.18)");
      gradient.addColorStop(1, "rgba(232,89,12,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        if (!reduced) {
          particle.x += particle.vx;
          particle.y += particle.vy;
        }
        if (particle.x < 0 || particle.x > width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > height) particle.vy *= -1;
        const dx = mouse.x - particle.x;
        const dy = mouse.y - particle.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 140 && !reduced) {
          particle.x -= dx * 0.002;
          particle.y -= dy * 0.002;
        }
        context.beginPath();
        context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        context.fillStyle = "rgba(255,247,237,0.6)";
        context.fill();
      }

      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i];
          const b = particles[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance < 110) {
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.strokeStyle = `rgba(232,89,12,${0.18 * (1 - distance / 110)})`;
            context.lineWidth = 0.6;
            context.stroke();
          }
        }
      }

      frame = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    canvas.addEventListener("mousemove", move);
    draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", move);
    };
  }, []);

  return <canvas aria-hidden="true" className="absolute inset-0 h-full w-full" ref={ref} />;
}
