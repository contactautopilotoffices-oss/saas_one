'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import ScrollSequenceCanvas from './ScrollSequenceCanvas';

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export default function ScrollVideoLanding() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useGSAP(() => {
    // 1. Link entire page scroll to Canvas progress
    ScrollTrigger.create({
      trigger: containerRef.current,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.1, // Small smoothing value
      onUpdate: (self) => {
        setProgress(self.progress);
      }
    });

    // 2. Hero Section Animations (Fades out as user scrolls down)
    gsap.to('.hero-content', {
      opacity: 0,
      y: -100,
      scale: 0.95,
      scrollTrigger: {
        trigger: '.hero-section',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      }
    });

    // 3. Features Section Animations (Fades in, cards stagger in)
    gsap.from('.feature-card', {
      opacity: 0,
      y: 100,
      rotateX: -15,
      stagger: 0.1,
      scrollTrigger: {
        trigger: '.features-section',
        start: 'top 80%',
        end: 'center center',
        scrub: 1,
      }
    });

    // 4. Stats Showcase Animations
    gsap.from('.stat-item', {
      opacity: 0,
      scale: 0.5,
      stagger: 0.2,
      scrollTrigger: {
        trigger: '.stats-section',
        start: 'top 70%',
        end: 'center center',
        scrub: 1,
      }
    });

    // 5. Final CTA Animations
    gsap.from('.cta-content', {
      opacity: 0,
      y: 50,
      scale: 0.9,
      scrollTrigger: {
        trigger: '.cta-section',
        start: 'top 80%',
        end: 'center center',
        scrub: 1,
      }
    });

  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="relative w-full bg-black text-white font-sans selection:bg-white/30">
      
      {/* =========================================
          LAYER 1: Fixed Canvas Animation
          ========================================= */}
      <div className="fixed top-0 left-0 w-full h-screen z-0 pointer-events-none overflow-hidden">
        <ScrollSequenceCanvas 
          progress={progress} 
          frameCount={240} 
          framePrefix="ezgif-frame-" 
          framePath="/ezgif-54c10109e38bcb8e-jpg" 
        />
        {/* Removed dark gradients to show video purely as it is */}
      </div>

      {/* =========================================
          LAYER 2: Scrollable Content Overlays
          ========================================= */}
      <div className="relative z-10 w-full flex flex-col">
        
        {/* SECTION 1: HERO (Scroll Range: 0% - 30%) */}
        <section className="hero-section h-[150vh] relative w-full">
          {/* Header */}
          <header className="absolute top-0 left-0 w-full p-8 md:p-12 flex justify-between items-center z-50">
            <Link href="/" className="block">
              <img src="/autopilot-logo-white.svg" alt="Autopilot Logo" className="h-6 md:h-8" />
            </Link>
            <Link href="/login" className="bg-white text-black px-6 py-2.5 text-sm font-bold tracking-wider rounded">
              LOG IN
            </Link>
          </header>

          <div className="hero-content h-screen flex flex-col justify-end pb-24 md:pb-32 px-8 md:px-16 w-full max-w-[1600px] mx-auto text-left">
            <h1 className="text-5xl sm:text-7xl md:text-[5.5rem] font-bold text-white mb-6 tracking-tight leading-[1.05]">
              Where Autonomy<br />Meets Operations.
            </h1>
            
            <div className="flex items-center gap-4 mt-2">
              <div className="w-[3px] h-6 bg-white/40"></div>
              <p className="text-white/80 text-lg md:text-xl font-medium tracking-wide">
                The building is the interface.
              </p>
            </div>
          </div>
        </section>


        {/* SECTION 2: FEATURES (Scroll Range: 30% - 60%) */}
        <section className="features-section min-h-[150vh] flex flex-col items-center justify-center px-6 py-20">
          <div className="max-w-5xl w-full">
            <div className="text-center mb-14 feature-card">
              <span className="inline-block px-4 py-1.5 bg-white/5 backdrop-blur-md text-white/80 text-xs font-bold tracking-widest uppercase rounded-full border border-white/10 mb-5 shadow-sm">
                Why Choose Autopilot
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 tracking-tight">
                Built for Cinematic
                <span className="block text-white/60 font-medium mt-1">
                  Facility Management
                </span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                { title: 'AI-Powered Routing', desc: 'Intelligent ticket assignment based on skills and availability.', icon: '🤖' },
                { title: 'WhatsApp Integration', desc: 'Users report issues instantly via WhatsApp. No app needed.', icon: '💬' },
                { title: 'Real-time Tracking', desc: 'Know exactly where every request stands at all times.', icon: '📍' },
                { title: 'Smart Escalation', desc: 'Never miss an SLA. Automatic escalation to right people.', icon: '⚡' },
                { title: 'Shift-Aware Assignment', desc: 'Workload distributed based on who is actually on shift.', icon: '👷' },
                { title: 'Deep Analytics', desc: 'Insights into team performance, trends, and bottlenecks.', icon: '📊' },
              ].map((feature, i) => (
                <div 
                  key={i} 
                  className="feature-card p-6 bg-black/60 backdrop-blur-lg rounded-2xl border border-white/10 hover:border-white/20 transition-colors shadow-lg"
                  style={{ perspective: '1000px' }}
                >
                  <div className="text-2xl mb-4 p-3 bg-white/5 inline-block rounded-xl border border-white/5">{feature.icon}</div>
                  <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 3: PRODUCT SHOWCASE / STATS (Scroll Range: 60% - 80%) */}
        <section className="stats-section h-[100vh] flex flex-col items-center justify-center px-6 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black pointer-events-none opacity-50" />
          <div className="max-w-5xl w-full grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 text-center relative z-10">
            {[
              { value: '500+', label: 'Facilities Powered' },
              { value: '50K+', label: 'Tickets/Month' },
              { value: '99.9%', label: 'System Uptime' },
              { value: '<2hr', label: 'Avg Resolution' },
            ].map((stat, i) => (
              <div key={i} className="stat-item p-6 md:p-8 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl">
                <div className="text-4xl md:text-5xl font-black mb-3 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
                  {stat.value}
                </div>
                <div className="text-xs md:text-sm text-white/60 font-bold uppercase tracking-widest">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 4: FINAL CTA (Scroll Range: 80% - 100%) */}
        <section className="cta-section h-[100vh] flex flex-col items-center justify-center px-6 text-center relative bg-black/60 backdrop-blur-sm">
          <div className="cta-content max-w-3xl flex flex-col items-center">
            <div className="w-16 h-16 mx-auto mb-6 bg-white text-black rounded-2xl flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.3)]">
              <div className="w-8 h-8 border-[3px] border-black rounded-sm rotate-45" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-5 tracking-tight leading-tight">
              Ready to Transform
              <br/>Your Facility?
            </h2>
            <p className="text-lg text-white/60 mb-10 font-medium">
              Join hundreds of high-end facilities already running smoothly on autopilot.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/login"
                className="px-8 py-3 bg-white text-black text-base font-bold rounded-xl hover:scale-105 transition-transform duration-300 shadow-[0_0_30px_rgba(255,255,255,0.2)]"
              >
                Get Started Free
              </Link>
              <Link
                href="/contact"
                className="px-8 py-3 bg-transparent border border-white/20 text-white text-base font-bold rounded-xl hover:bg-white/10 transition-colors duration-300"
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </section>

        {/* Footer (Static at very bottom) */}
        <footer className="relative z-20 bg-black border-t border-white/10 py-10">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-black rounded-sm rotate-45" />
              </div>
              <span className="font-bold text-xl tracking-tight">Autopilot</span>
            </div>
            <p className="text-white/40 font-medium">© 2024 Autopilot OS. All rights reserved.</p>
            <div className="flex gap-8">
              <Link href="/privacy" className="text-white/40 hover:text-white font-medium transition-colors">Privacy</Link>
              <Link href="/terms" className="text-white/40 hover:text-white font-medium transition-colors">Terms</Link>
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}
