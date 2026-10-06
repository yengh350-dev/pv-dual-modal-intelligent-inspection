import{h as t,P as d}from"./index-BjY30Np8.js";import{j as a}from"./react-vendor-BK-eOE7D.js";import{u as l}from"./motion-engine-bKzNr2dC.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=t("BatteryCharging",[["path",{d:"M15 7h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2",key:"1sdynx"}],["path",{d:"M6 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1",key:"1gkd3k"}],["path",{d:"m11 7-3 5h4l-3 5",key:"b4a64w"}],["line",{x1:"22",x2:"22",y1:"11",y2:"13",key:"4dh1rd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=t("Navigation",[["polygon",{points:"3 11 22 2 13 21 11 13 3 11",key:"1ltx0t"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=t("Radio",[["path",{d:"M4.9 19.1C1 15.2 1 8.8 4.9 4.9",key:"1vaf9d"}],["path",{d:"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5",key:"u1ii0m"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["path",{d:"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5",key:"1j5fej"}],["path",{d:"M19.1 4.9C23 8.8 23 15.1 19.1 19",key:"10b0cb"}]]);function g({mission:e,moving:n,showPlanned:r=!0,revision:s=0}){const c=l(),o=n&&!c;return a.jsxs("g",{className:"flight-overlay",children:[r?a.jsx("path",{className:"planned-route",d:e.plannedRoute}):null,a.jsx("path",{className:n?"actual-route running":"actual-route",d:e.actualRoute}),a.jsxs("g",{className:o?"drone-point drone-moving":"drone-point",transform:`translate(${e.droneX} ${e.droneY})`,children:[a.jsx("path",{className:"scan-fan",d:"M0 0 L92 -44 A102 102 0 0 1 92 44 Z"}),a.jsx("circle",{className:"drone-aura",r:"32"}),a.jsx("circle",{className:"drone-core",r:"20"}),a.jsx(d,{className:"drone-glyph",x:"-11",y:"-11",width:"22",height:"22"}),o?a.jsx("animateMotion",{dur:"16s",repeatCount:"indefinite",path:e.actualRoute,rotate:"auto"}):null]})]},`${e.id}-${s}`)}export{g as A,p as B,y as N,x as R};
