'use client';

import React from 'react';
import ScrollVideoLanding from '@/frontend/components/landing/ScrollVideoLanding';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="bg-black">
      {/* Scroll Video Section */}
      <ScrollVideoLanding />

      {/* CTA Section */}
      <div className="min-h-screen bg-gradient-to-b from-black via-slate-900 to-black flex flex-col items-center justify-center px-6">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white rounded-sm rotate-45" />
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-4xl md:text-6xl font-black text-white leading-tight">
            The Operating System for
            <span className="block bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Modern Buildings
            </span>
          </h1>

          {/* Description */}
          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto">
            Facilities that run without constant follow-ups. Fewer complaints.
            Faster fixes. Clear accountability.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/login"
              className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/30 hover:scale-105"
            >
              Start Free Trial
            </Link>
            <Link
              href="/demo"
              className="w-full sm:w-auto px-8 py-4 border-2 border-gray-600 hover:border-gray-400 text-white font-bold rounded-xl transition-all hover:bg-white/5"
            >
              Watch Demo
            </Link>
          </div>

          {/* Trust Badges */}
          <div className="pt-12 space-y-4">
            <p className="text-sm text-gray-500 uppercase tracking-wider">Trusted by 500+ facilities</p>
            <div className="flex items-center justify-center gap-8 opacity-50">
              <div className="text-2xl font-black text-white">TechCorp</div>
              <div className="text-2xl font-black text-white">InnovateX</div>
              <div className="text-2xl font-black text-white">BuildRight</div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {[
            {
              title: 'AI-Powered',
              description: 'Smart ticket routing and automatic assignment',
              icon: '🤖'
            },
            {
              title: 'Real-time Tracking',
              description: 'Monitor all requests from creation to resolution',
              icon: '⚡'
            },
            {
              title: 'WhatsApp Native',
              description: 'Users report issues via WhatsApp instantly',
              icon: '💬'
            }
          ].map((feature, index) => (
            <div
              key={index}
              className="p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-white/20 transition-all"
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
              <p className="text-gray-400">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Final CTA */}
        <div className="mt-24 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Ready to transform your facility operations?
          </h2>
          <Link
            href="/login"
            className="inline-block px-12 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-600/30 hover:scale-105"
          >
            Get Started Now
          </Link>
        </div>

        {/* Footer */}
        <footer className="mt-24 py-8 border-t border-white/10 w-full max-w-5xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 border border-white rounded-sm rotate-45" />
              </div>
              <span className="font-bold text-white">Autopilot</span>
            </div>
            <p className="text-sm text-gray-500">
              © 2024 Autopilot. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
