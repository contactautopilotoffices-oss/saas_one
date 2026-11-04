'use client';

import React from 'react';
import ScrollVideoLanding from '@/frontend/components/landing/ScrollVideoLanding';
import Link from 'next/link';
import Image from 'next/image';
import { Route, ListChecks, MessageCircle } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="bg-black">
      {/* Scroll Video Section */}
      <ScrollVideoLanding />

      {/* CTA Section */}
      <div className="min-h-screen bg-gradient-to-b from-black to-slate-950 flex flex-col items-center justify-center px-6 pt-16 md:pt-32">
        <div className="max-w-3xl mx-auto text-center">
          {/* Logo */}
          <div className="flex items-center justify-center mb-10">
            <Image src="/autopilot-logo-white.svg" alt="Autopilot" width={32} height={40} unoptimized className="h-10 w-auto" />
          </div>

          {/* Heading */}
          <h1 className="font-display text-4xl md:text-6xl font-semibold text-white leading-[1.08] tracking-tight">
            The operating system for
            <span className="block text-primary-light">
              modern buildings
            </span>
          </h1>

          {/* Description */}
          <p className="mt-6 text-lg md:text-xl leading-8 text-slate-400 max-w-xl mx-auto">
            Facilities that run without constant follow-ups. Fewer complaints.
            Faster fixes. Clear accountability.
          </p>

          {/* CTA Buttons */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-6 bg-secondary hover:bg-secondary-light text-slate-950 text-[15px] font-medium rounded-[10px] transition-colors duration-150 active:scale-[0.98]"
            >
              Get started
            </Link>
            <Link
              href="/demo"
              className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-6 border border-white/15 hover:border-white/30 hover:bg-white/[0.04] text-white text-[15px] font-medium rounded-[10px] transition-colors duration-150"
            >
              Watch demo
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-5xl mx-auto">
          {[
            {
              title: 'Ticket routing',
              description: 'Tickets are routed and assigned automatically',
              icon: Route
            },
            {
              title: 'Request tracking',
              description: 'Monitor all requests from creation to resolution',
              icon: ListChecks
            },
            {
              title: 'WhatsApp reporting',
              description: 'Users report issues over WhatsApp',
              icon: MessageCircle
            }
          ].map((feature, index) => (
            <div
              key={index}
              className="p-6 bg-white/[0.03] rounded-2xl border border-white/[0.08]"
            >
              <feature.icon className="w-[18px] h-[18px] text-slate-400 mb-4" strokeWidth={1.5} />
              <h3 className="text-base font-medium text-white mb-2">{feature.title}</h3>
              <p className="text-sm leading-6 text-slate-400">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Final CTA */}
        <div className="mt-32 text-center">
          <h2 className="font-display text-2xl md:text-3xl font-semibold text-white tracking-tight mb-8">
            Run your facilities without constant follow-ups
          </h2>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-12 px-8 bg-secondary hover:bg-secondary-light text-slate-950 text-[15px] font-medium rounded-[10px] transition-colors duration-150 active:scale-[0.98]"
          >
            Get started
          </Link>
        </div>

        {/* Footer */}
        <footer className="mt-32 py-8 border-t border-white/[0.08] w-full max-w-5xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Image src="/autopilot-logo-white.svg" alt="" width={16} height={20} unoptimized className="h-5 w-auto" />
              <span className="font-semibold text-white">Autopilot</span>
            </div>
            <p className="text-sm text-slate-500">
              © 2024 Autopilot. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
