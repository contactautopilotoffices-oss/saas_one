export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="size-8 text-[#1337ec] flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">grid_view</span>
              </div>
              <h2 className="text-slate-900 text-xl font-bold tracking-tight">OpsCentral</h2>
            </div>
            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-8">
              <a className="text-sm font-medium text-slate-600 hover:text-[#1337ec] transition-colors" href="#features">Features</a>
              <a className="text-sm font-medium text-slate-600 hover:text-[#1337ec] transition-colors" href="#security">Security</a>
              <a className="text-sm font-medium text-slate-600 hover:text-[#1337ec] transition-colors" href="#pricing">Pricing</a>
            </nav>
            {/* CTA */}
            <div className="flex items-center gap-4">
              <button className="hidden sm:flex h-10 px-5 items-center justify-center rounded-lg bg-[#1337ec] text-white text-sm font-bold shadow-lg shadow-[#1337ec]/20 hover:bg-blue-700 transition-all">
                Get Started
              </button>
              {/* Mobile Menu Icon */}
              <button className="md:hidden p-2 text-slate-600">
                <span className="material-symbols-outlined">menu</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-16 pb-20 lg:pt-24 lg:pb-32 overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            {/* Text Content */}
            <div className="flex flex-col gap-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 text-[#1337ec] w-fit mx-auto lg:mx-0">
                <span className="material-symbols-outlined text-sm">new_releases</span>
                <span className="text-xs font-bold uppercase tracking-wide">New Multi-Site Dashboard</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 leading-[1.15] tracking-tight">
                Centralize Your <br className="hidden lg:block" />
                <span className="text-[#1337ec]">Facility Operations</span>
              </h1>
              <p className="text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                The all-in-one platform for modern facilities. Manage everything from visitor access and desk booking to HVAC monitoring in one place.
              </p>
              <div className="flex flex-wrap gap-4 justify-center lg:justify-start pt-2">
                <button className="h-12 px-8 rounded-lg bg-[#1337ec] text-white text-base font-bold shadow-xl shadow-[#1337ec]/25 hover:bg-blue-700 hover:shadow-[#1337ec]/40 transition-all transform hover:-translate-y-0.5">
                  Request Demo
                </button>
                <button className="h-12 px-8 rounded-lg bg-white border border-slate-200 text-slate-700 text-base font-bold hover:bg-slate-50 transition-all">
                  View Features
                </button>
              </div>
              <div className="pt-6 flex items-center justify-center lg:justify-start gap-4 text-sm text-slate-500">
                <div className="flex -space-x-2">
                  <div className="size-8 rounded-full bg-slate-200 border-2 border-white"></div>
                  <div className="size-8 rounded-full bg-slate-300 border-2 border-white"></div>
                  <div className="size-8 rounded-full bg-slate-400 border-2 border-white"></div>
                </div>
                <p>Trusted by 500+ Office Managers</p>
              </div>
            </div>
            {/* Hero Image */}
            <div className="relative w-full aspect-[4/3] lg:aspect-square max-w-[600px] mx-auto">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#1337ec]/20 to-blue-500/20 rounded-2xl transform rotate-3 scale-95 blur-2xl -z-10"></div>
              <div className="w-full h-full bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden relative">
                {/* Abstract UI Representation */}
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCthIXpdQgG2wkyJOgfDvfEkIR55sjinxuSAH2h1K5gpKaL3cd6O_HZKyH0rFwh6bF-KOy073J7FQN69N2-pvfgH5oOBKWDzfypduXnoe4y5YkpZwRbqVo8tMfOqLzyE6d2VdkcqRRA1K0afC_vMhLojAosdiPDCHZ3ASjexcCTKPv6eHLL8jBAvHf-EaDFVaClvxsNmsCk8Q73h03v0fBZWEEOOZLEqDJkM1L54GbE7BeD1eHPLLwwC_mcVLY5qmTZlDFE7m-8LWA8')"
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent opacity-20"></div>
                </div>
              </div>
              {/* Floating Card */}
              <div className="absolute -bottom-6 -left-6 bg-white p-4 rounded-lg shadow-xl border border-slate-100 max-w-[200px] animate-float">
                <div className="flex items-center gap-3 mb-2">
                  <div className="bg-green-100 p-1.5 rounded-full text-green-600">
                    <span className="material-symbols-outlined text-lg">check_circle</span>
                  </div>
                  <span className="text-sm font-bold text-slate-800">System Optimal</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 w-[92%]"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By Logos */}
      <section className="py-10 border-y border-slate-200 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold text-slate-500 uppercase tracking-widest mb-8">Trusted by industry leaders</p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
            <h3 className="text-2xl font-black text-slate-800">ACME<span className="text-[#1337ec]">CORP</span></h3>
            <h3 className="text-2xl font-bold text-slate-800 italic">Globex</h3>
            <h3 className="text-2xl font-bold text-slate-800">Soylent<span className="font-light">Inc</span></h3>
            <h3 className="text-2xl font-bold text-slate-800 tracking-tighter">UMBRELLA</h3>
            <h3 className="text-2xl font-bold text-slate-800 font-serif">Initech</h3>
          </div>
        </div>
      </section>

      {/* Problem Statement */}
      <section className="py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6 leading-tight">
            Stop drowning in spreadsheets
          </h2>
          <p className="text-lg md:text-xl text-slate-600 leading-relaxed">
            Managing multi-site operations shouldn&apos;t be manual. Eliminate fragmented tools, siloed data, and gain total visibility across your entire portfolio with a single source of truth.
          </p>
        </div>
      </section>

      {/* Core Capabilities Grid */}
      <section className="py-20 bg-slate-50 rounded-3xl mx-4 lg:mx-8 mb-8 shadow-sm border border-slate-100" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Core Capabilities</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">Everything you need to run your facilities smoothly, packaged in a modern interface.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Feature 1 */}
            <div className="group p-6 rounded-xl bg-white border border-slate-100 hover:border-[#1337ec]/50 transition-colors shadow-sm hover:shadow-md">
              <div className="size-12 rounded-lg bg-[#1337ec]/10 text-[#1337ec] flex items-center justify-center mb-4 group-hover:bg-[#1337ec] group-hover:text-white transition-colors">
                <span className="material-symbols-outlined">calendar_month</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Desk &amp; Room Booking</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Seamlessly manage shared spaces and hybrid work schedules with real-time availability.</p>
            </div>
            {/* Feature 2 */}
            <div className="group p-6 rounded-xl bg-white border border-slate-100 hover:border-[#1337ec]/50 transition-colors shadow-sm hover:shadow-md">
              <div className="size-12 rounded-lg bg-[#1337ec]/10 text-[#1337ec] flex items-center justify-center mb-4 group-hover:bg-[#1337ec] group-hover:text-white transition-colors">
                <span className="material-symbols-outlined">build</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Maintenance Requests</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Automate ticket creation, assignment, and tracking for facility repairs and upkeep.</p>
            </div>
            {/* Feature 3 */}
            <div className="group p-6 rounded-xl bg-white border border-slate-100 hover:border-[#1337ec]/50 transition-colors shadow-sm hover:shadow-md">
              <div className="size-12 rounded-lg bg-[#1337ec]/10 text-[#1337ec] flex items-center justify-center mb-4 group-hover:bg-[#1337ec] group-hover:text-white transition-colors">
                <span className="material-symbols-outlined">engineering</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Vendor Management</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Centralize vendor contracts, compliance docs, and performance ratings in one portal.</p>
            </div>
            {/* Feature 4 */}
            <div className="group p-6 rounded-xl bg-white border border-slate-100 hover:border-[#1337ec]/50 transition-colors shadow-sm hover:shadow-md">
              <div className="size-12 rounded-lg bg-[#1337ec]/10 text-[#1337ec] flex items-center justify-center mb-4 group-hover:bg-[#1337ec] group-hover:text-white transition-colors">
                <span className="material-symbols-outlined">inventory_2</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Asset Tracking</h3>
              <p className="text-sm text-slate-600 leading-relaxed">Keep a digital twin of your physical assets, from laptops to office furniture.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Solution Deep Dive */}
      <section className="py-24 overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            {/* Content */}
            <div className="lg:w-1/2 flex flex-col gap-8">
              <div>
                <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-4">
                  One Dashboard, <br />
                  <span className="text-[#1337ec]">Infinite Control</span>
                </h2>
                <p className="text-lg text-slate-600">
                  Gain helicopter view of your operations. Our multi-tenant architecture allows you to switch between sites instantly without losing context.
                </p>
              </div>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="shrink-0 mt-1 text-[#1337ec]">
                    <span className="material-symbols-outlined">analytics</span>
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-slate-900">Real-time Analytics</h4>
                    <p className="text-slate-600">Monitor occupancy rates and utility usage as they happen.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="shrink-0 mt-1 text-[#1337ec]">
                    <span className="material-symbols-outlined">sync</span>
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-slate-900">Integrations Ecosystem</h4>
                    <p className="text-slate-600">Connects with Slack, Microsoft Teams, and existing IoT sensors.</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Visual */}
            <div className="lg:w-1/2 w-full">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white aspect-video">
                <img
                  alt="Dashboard view showing real-time graphs and map data for facility management"
                  className="object-cover w-full h-full opacity-90 hover:scale-105 transition-transform duration-700"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAM51dP-tcaACEa43hdtfMi5LTE9_IoCJhyMzmd3N2iXK-ejD2-jYKDjqljG7CnrG1sLvw9sdJtQyf_vWBPjdWIzZjwg_F8HVFhCXGIUK7kvJYjcT0KuJbTk2MOOmbMumb94PNKt16ybMLpwCD2DPn0Juj0bAZPUUOyoxb6lcqHRA4Ksx9ky3iRCARLJLH-m-7o89TWgJhfx6XCCDOASb-FlQQYxUGD3GB2sghFta_tEpUxYpQx1gtxHRUM2dN4pgRpgW3CkOokMrK3"
                />
                {/* Overlay UI Element */}
                <div className="absolute top-4 right-4 bg-white p-3 rounded-lg shadow-lg border border-slate-100 flex items-center gap-3">
                  <div className="size-3 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-bold text-slate-700">Alert: HVAC System B</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Compliance */}
      <section className="py-20 bg-slate-900 text-white rounded-3xl mx-4 mb-20 relative overflow-hidden" id="security">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(#4b5563 1px, transparent 1px)", backgroundSize: "32px 32px" }}></div>
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-[#1337ec]/20 text-[#1337ec] mb-6">
            <span className="material-symbols-outlined text-3xl">security</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Enterprise-Grade Security</h2>
          <p className="text-lg text-slate-300 mb-10 max-w-2xl mx-auto">
            Your data is your most valuable asset. We protect it with banking-level encryption and rigorous compliance standards.
          </p>
          <div className="flex flex-wrap justify-center gap-4 md:gap-8">
            <div className="bg-white/10 backdrop-blur-sm px-6 py-3 rounded-lg border border-white/10 flex items-center gap-2">
              <span className="material-symbols-outlined text-green-400">verified_user</span>
              <span className="font-semibold">SOC 2 Type II</span>
            </div>
            <div className="bg-white/10 backdrop-blur-sm px-6 py-3 rounded-lg border border-white/10 flex items-center gap-2">
              <span className="material-symbols-outlined text-green-400">verified_user</span>
              <span className="font-semibold">GDPR Compliant</span>
            </div>
            <div className="bg-white/10 backdrop-blur-sm px-6 py-3 rounded-lg border border-white/10 flex items-center gap-2">
              <span className="material-symbols-outlined text-green-400">lock</span>
              <span className="font-semibold">SSO / 2FA</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-24 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <div className="bg-gradient-to-r from-[#1337ec] to-blue-600 rounded-3xl p-10 md:p-16 text-center text-white shadow-2xl shadow-[#1337ec]/30 relative overflow-hidden">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-white opacity-10 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-black opacity-10 rounded-full blur-3xl"></div>
            <h2 className="text-3xl md:text-5xl font-bold mb-6 relative z-10">Ready to modernize your operations?</h2>
            <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto relative z-10">Join forward-thinking companies that have streamlined their workplace management with OpsCentral.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
              <button className="bg-white text-[#1337ec] font-bold py-4 px-8 rounded-lg hover:bg-slate-100 transition-colors shadow-lg">
                Get Started Now
              </button>
              <button className="bg-transparent border border-white text-white font-bold py-4 px-8 rounded-lg hover:bg-white/10 transition-colors">
                Talk to Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="size-6 text-[#1337ec] flex items-center justify-center">
                  <span className="material-symbols-outlined">grid_view</span>
                </div>
                <h2 className="text-slate-900 text-lg font-bold">OpsCentral</h2>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed">
                Empowering modern workplaces with centralized operational control.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 mb-4">Platform</h4>
              <ul className="space-y-2 text-sm text-slate-600">
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Features</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Integrations</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Pricing</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Changelog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-slate-600">
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">About Us</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Careers</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Blog</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-slate-900 mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-slate-600">
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Privacy Policy</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Terms of Service</a></li>
                <li><a className="hover:text-[#1337ec] transition-colors" href="#">Security</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-slate-500 text-sm">© 2026 OpsCentral Inc. All rights reserved.</p>
            <div className="flex gap-4 text-slate-400">
              <a className="hover:text-[#1337ec]" href="#"><span className="material-symbols-outlined text-xl">share</span></a>
              <a className="hover:text-[#1337ec]" href="#"><span className="material-symbols-outlined text-xl">rss_feed</span></a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
