import React from 'react';
import { Input } from "@/components/ui/input";

export default function LightPallet() {
  const surfaceColors = [
    { name: 'Background App', hex: '#ffffff', desc: 'Main application background' },
    { name: 'Background Content', hex: '#f9fafb', desc: 'Standard content area' },
    { name: 'Surface 1', hex: '#f3f4f6', desc: 'Cards, sidebars, secondary panels' },
    { name: 'Surface 2', hex: '#e5e7eb', desc: 'Interactive elements, headers' },
    { name: 'Surface 3', hex: '#d1d5db', desc: 'Hover states, elevated panels' },
    { name: 'Surface 4', hex: '#c4c8cc', desc: 'Highly elevated, dialogs, dropdowns' },
    { name: 'Border Subtle', hex: '#e5e5e5', desc: 'Faint borders, separators' },
    { name: 'Border Strong', hex: '#d4d4d4', desc: 'Distinct borders, active edges' },
  ];

  const textColors = [
    { name: 'Text Primary', hex: '#171717', desc: 'Headings, active text' },
    { name: 'Text Secondary', hex: '#525252', desc: 'Body text, descriptions' },
    { name: 'Text Muted', hex: '#a3a3a3', desc: 'Placeholders, disabled text' },
  ];

  const accentColors = [
    { name: 'Accent Primary', hex: '#2563eb', desc: 'Primary actions, links' },
    { name: 'Accent Success', hex: '#22c55e', desc: 'Success states, confirmations' },
    { name: 'Accent Warning', hex: '#f59e0b', desc: 'Warning states, notifications' },
    { name: 'Accent Danger', hex: '#ef4444', desc: 'Error states, destructive actions' },
    { name: 'Accent Info', hex: '#3b82f6', desc: 'Informational states' },
  ];

  return (
    <div className="flex flex-col w-full min-h-screen bg-white">
      <div className="min-h-screen bg-white text-[#171717] p-6 sm:p-10 font-sans selection:bg-[#d1d5db]">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="space-y-4 border-b border-[#e5e5e5] pb-8 pt-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f3f4f6] border border-[#e5e5e5] mb-4">
               <div className="w-2 h-2 rounded-full bg-[#171717]"></div>
               <span className="text-xs font-medium text-text-tertiary">Design System</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-[#171717]">Light Mode Theme Palette</h1>
            <p className="text-text-tertiary text-lg max-w-2xl leading-relaxed">
              A clean, minimal light theme built on progressive shades of gray. Use these surfaces and text tones for interfaces that feel airy, readable, and professional.
            </p>
          </div>

          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-[#171717] flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>
                Surfaces & Borders
              </h2>
              <p className="text-text-tertiary text-sm">Progressive shades from base app background to highest elevation</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {surfaceColors.map((color) => (
                <div key={color.hex} className="group relative rounded-xl overflow-hidden border border-[#e5e5e5] transition-all duration-300 hover:border-[#d4d4d4] hover:-translate-y-1 bg-white shadow-sm">
                  <div 
                    className="h-28 w-full flex items-end p-3 transition-colors duration-200 border-b border-[#e5e5e5]/50" 
                    style={{ backgroundColor: color.hex }}
                  >
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between font-mono text-sm mb-1">
                      <span className="text-[#171717] font-medium">{color.hex}</span>
                    </div>
                    <h3 className="text-sm font-medium text-[#171717] mb-1">{color.name}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{color.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-[#171717] flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>
                Typography
              </h2>
              <p className="text-text-tertiary text-sm">Text colors tailored for legibility on light backgrounds</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {textColors.map((color) => (
                <div key={color.hex} className="flex items-center gap-4 p-5 rounded-xl border border-[#e5e5e5] bg-[#f9fafb] hover:border-[#d4d4d4] transition-colors duration-200">
                  <div 
                    className="w-12 h-12 rounded-full border border-[#e5e5e5] shrink-0 flex items-center justify-center text-lg font-bold"
                    style={{ backgroundColor: color.hex, color: '#ffffff' }}
                  >
                    Aa
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-[#171717]">{color.name}</h3>
                      <span className="text-xs font-mono text-text-tertiary bg-[#e5e7eb] px-1.5 py-0.5 rounded">{color.hex}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{color.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-[#171717] flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>
                Accent Colors
              </h2>
              <p className="text-text-tertiary text-sm">Semantic colors for actions, statuses, and interactive elements</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {accentColors.map((color) => (
                <div key={color.hex} className="flex flex-col items-center gap-3 p-5 rounded-xl border border-[#e5e5e5] bg-white hover:border-[#d4d4d4] hover:shadow-sm transition-all duration-200">
                  <div 
                    className="w-12 h-12 rounded-full shadow-sm"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="text-center">
                    <h3 className="text-sm font-medium text-[#171717]">{color.name}</h3>
                    <span className="text-xs font-mono text-muted-foreground">{color.hex}</span>
                    <p className="text-xs text-muted-foreground mt-1">{color.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-medium text-[#171717] flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                UI Example Application
              </h2>
              <p className="text-text-tertiary text-sm">How these colors come together to build coherent interfaces</p>
            </div>
            
            <div className="relative rounded-2xl border border-[#e5e5e5] bg-[#f9fafb] overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-lg h-32 bg-[#3b82f6]/5 blur-[100px] pointer-events-none"></div>
              
              <div className="p-8 sm:p-16 flex items-center justify-center relative z-10 w-full">
                <div className="w-full max-w-lg bg-white border border-[#e5e5e5] rounded-xl overflow-hidden shadow-lg flex flex-col">
                  <div className="px-5 py-4 border-b border-[#e5e5e5] bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-[#f3f4f6] border border-[#e5e5e5] flex items-center justify-center text-text-tertiary">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                      </div>
                      <div>
                        <h3 className="text-[#171717] font-medium text-sm">Application Settings</h3>
                        <p className="text-xs text-text-tertiary">Manage core configuration</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-5 bg-[#f9fafb] grow">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[#171717]">Framework Name</label>
                      <Input 
                        defaultValue="geiger-flow"
                        className="bg-white border-[#e5e5e5] text-[#171717] placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:border-[#d4d4d4]"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-[#171717]">Environment Setup</label>
                      <div className="rounded-lg border border-[#e5e5e5] bg-white overflow-hidden">
                        <div className="flex items-center justify-between p-3 border-b border-[#e5e5e5] hover:bg-[#f3f4f6] transition-colors cursor-pointer">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            <span className="text-sm text-[#171717] font-medium">Production</span>
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">v2.4.1</span>
                        </div>
                        <div className="flex items-center justify-between p-3 hover:bg-[#f3f4f6] transition-colors cursor-pointer">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-[#d4d4d4]"></div>
                            <span className="text-sm text-text-tertiary">Staging</span>
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">v2.4.2-beta</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4 border-t border-[#e5e5e5] bg-white flex items-center justify-between mt-auto">
                    <button className="text-sm font-medium text-text-tertiary hover:text-[#171717] transition-colors duration-200 px-3 py-2">
                      Cancel
                    </button>
                    <button className="bg-[#171717] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#262626] transition-colors duration-200 flex items-center gap-2">
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
