import React from 'react';
import { Input } from "@/components/ui/input";

export default function Pallet() {
  const surfaceColors = [
    { name: 'Background App', hex: '#161616', desc: 'Main application background' },
    { name: 'Background Content', hex: '#1a1a1a', desc: 'Standard content area' },
    { name: 'Surface 1', hex: '#202020', desc: 'Cards, sidebars, secondary panels' },
    { name: 'Surface 2', hex: '#242424', desc: 'Interactive elements, headers' },
    { name: 'Surface 3', hex: '#2a2a2a', desc: 'Hover states, elevated panels' },
    { name: 'Surface 4', hex: '#2e2e2e', desc: 'Highly elevated, dialogs, dropdowns' },
    { name: 'Border Subtle', hex: '#333333', desc: 'Faint borders, separators' },
    { name: 'Border Strong', hex: '#474747', desc: 'Distinct borders, active edges' },
  ];

  const textColors = [
    { name: 'Text Primary', hex: '#ffffff', desc: 'Headings, active text' },
    { name: 'Text Secondary', hex: '#a3a3a3', desc: 'Body text, descriptions' },
    { name: 'Text Muted', hex: '#737373', desc: 'Placeholders, disabled text' },
  ];

  return (
    <div className="flex flex-col w-full min-h-screen bg-[#161616]">
      <div className="min-h-screen bg-[#161616] text-[#ededed] p-6 sm:p-10 font-sans selection:bg-[#333333]">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="space-y-4 border-b border-[#2a2a2a] pb-8 pt-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#202020] border border-[#2a2a2a] mb-4">
               <div className="w-2 h-2 rounded-full bg-white"></div>
               <span className="text-xs font-medium text-[#a3a3a3]">Design System</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white">Dark Mode Theme Palette</h1>
            <p className="text-[#a3a3a3] text-lg max-w-2xl leading-relaxed">
              A carefully curated, lighter dark style starting at #161616 minimum brightness. Use these progressive shades to build hierarchy, depth, and contrast in interfaces.
            </p>
          </div>
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-white flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#737373]"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>
                Surfaces & Borders
              </h2>
              <p className="text-[#a3a3a3] text-sm">Progressive shades from base app background to highest elevation</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {surfaceColors.map((color) => (
                <div key={color.hex} className="group relative rounded-xl overflow-hidden border border-[#2a2a2a] transition-all duration-300 hover:border-[#474747] hover:-translate-y-1 bg-[#1a1a1a]">
                  <div 
                    className="h-28 w-full flex items-end p-3 transition-colors duration-200 border-b border-[#2a2a2a]/50" 
                    style={{ backgroundColor: color.hex }}
                  >
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between font-mono text-sm mb-1">
                      <span className="text-white font-medium">{color.hex}</span>
                    </div>
                    <h3 className="text-sm font-medium text-[#e5e5e5] mb-1">{color.name}</h3>
                    <p className="text-xs text-[#737373] leading-relaxed line-clamp-2">{color.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-white flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#737373]"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>
                Typography
              </h2>
              <p className="text-[#a3a3a3] text-sm">Text colors tailored for legibility on dark backgrounds</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {textColors.map((color) => (
                <div key={color.hex} className="flex items-center gap-4 p-5 rounded-xl border border-[#2a2a2a] bg-[#202020] hover:border-[#474747] transition-colors duration-200">
                  <div 
                    className="w-12 h-12 rounded-full border border-[#333333] shrink-0 flex items-center justify-center text-lg font-bold"
                    style={{ backgroundColor: color.hex, color: '#161616' }}
                  >
                    Aa
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-white">{color.name}</h3>
                      <span className="text-xs font-mono text-[#a3a3a3] bg-[#2a2a2a] px-1.5 py-0.5 rounded">{color.hex}</span>
                    </div>
                    <p className="text-xs text-[#737373]">{color.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-white flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#737373]"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                UI Example Application
              </h2>
              <p className="text-[#a3a3a3] text-sm">How these colors come together to build coherent interfaces</p>
            </div>
            
            <div className="relative rounded-2xl border border-[#2a2a2a] bg-[#161616] overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-lg h-32 bg-white/5 blur-[100px] pointer-events-none"></div>
              
              <div className="p-8 sm:p-16 flex items-center justify-center relative z-10 w-full">
                  
                <div className="w-full max-w-lg bg-[#202020] border border-[#2a2a2a] rounded-xl overflow-hidden shadow-2xl flex flex-col">
                  <div className="px-5 py-4 border-b border-[#2a2a2a] bg-[#202020] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-[#2a2a2a] border border-[#333333] flex items-center justify-center text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                      </div>
                      <div>
                        <h3 className="text-white font-medium text-sm">Application Settings</h3>
                        <p className="text-xs text-[#a3a3a3]">Manage core configuration</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-5 space-y-5 bg-[#1a1a1a] grow">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[#e5e5e5]">Framework Name</label>
                      <Input 
                        defaultValue="geiger-flow"
                        className="bg-[#161616] border-[#2a2a2a] text-white placeholder:text-[#737373] focus-visible:ring-0 focus-visible:border-[#474747]"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[#e5e5e5]">Environment Setup</label>
                      <div className="rounded-lg border border-[#2a2a2a] bg-[#202020] overflow-hidden">
                        <div className="flex items-center justify-between p-3 border-b border-[#2a2a2a] hover:bg-[#242424] transition-colors cursor-pointer">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            <span className="text-sm text-[#e5e5e5]">Production</span>
                          </div>
                          <span className="text-xs text-[#737373] font-mono">v2.4.1</span>
                        </div>
                        <div className="flex items-center justify-between p-3 hover:bg-[#242424] transition-colors cursor-pointer">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-[#474747]"></div>
                            <span className="text-sm text-[#a3a3a3]">Staging</span>
                          </div>
                          <span className="text-xs text-[#737373] font-mono">v2.4.2-beta</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-4 border-t border-[#2a2a2a] bg-[#202020] flex items-center justify-between mt-auto">
                    <button className="text-sm font-medium text-[#a3a3a3] hover:text-white transition-colors duration-200 px-3 py-2">
                      Cancel
                    </button>
                    <button className="bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#e5e5e5] transition-colors duration-200 flex items-center gap-2">
                      Save Changes
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
