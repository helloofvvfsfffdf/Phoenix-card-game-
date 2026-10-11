# Bundled victory scene — provenance and licences

These files are byte-identical to the successful local victory study 01.
`manifest.json` records SHA-256 hashes/sizes. Total runtime/effect/texture payload:
1,663,862 bytes (~1.59 MiB). No runtime CDN, Downloads-folder path, editor or
external server is required when the game is deployed.

## Effect samples — CC0

Source: official **Effekseer 1.80.7 Windows** sample distribution, already present
on the owner's computer in `Downloads/Effekseer1.80.7Win/Effekseer1.80.7Win/Sample`.
Release: https://github.com/effekseer/Effekseer/releases/tag/1807

The distribution's `Sample/readme.txt` states:

> All the licenses of these effects are CC-0.
> We'd appreciate it if you could credit Effekseer and the contributor somewhere in your works.

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
Voluntary credits: **Effekseer Project**, **AndrewFM** (Boss Death sample).

- `effects/boss-death/boss_death.efk`: the exact binary exported by the official
  1.80.7 editor from a temporary copy of `01_AndrewFM01/boss_death.efkproj`, used
  in the approved test. Its three unchanged referenced textures are bundled
  alongside it: `actionlines.png`, `Particle01.png`, `LaserMain02.png`.
- `effects/fireworks/Simple_Turbulence_Fireworks.efkefc`: the unchanged original
  `00_Basic` runtime sample, with its two unchanged referenced textures:
  `Particle01.png`, `Particle02.png`.

No effect nodes, textures or exported binary contents were redesigned. Playback
positions/scales and the 9.7-second timeline match the approved test.

## Effekseer WebGL/WebAssembly runtime — MIT

Version **1.80.7**. Original `effekseer.min.js` and `effekseer.wasm` from:
https://github.com/effekseer/Effekseer/releases/download/1807/EffekseerForWebGL1.80.7.zip

Licence source: https://github.com/effekseer/EffekseerForWebGL/blob/master/LICENSE

The MIT License (MIT)

Copyright (c) 2011 Effekseer Project

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## GSAP — Standard "No Charge" licence, NOT MIT

Version **3.15.0**. Original minified file (proprietary notice retained):
https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js
Package licence reference: https://cdn.jsdelivr.net/npm/gsap@3.15.0/package.json
Full licence: https://gsap.com/standard-license/

Verified 2026-10-11. Effective date April 30, 2025; last modified May 30, 2025.
Copyright (©) 2025, Webflow.

### I. Definitions

“GSAP License” means the terms and conditions of this GSAP Software License Agreement.
"GSAP Products" means any Software made available at gsap.com or any successor
sites, including but not limited to the GSAP animation library and related plugins,
tools, or extensions.
"Permitted Uses" means the implementation and/or use of GSAP Products on any
website, web application, or digital interface by any person or entity (which may
include, for clarity, those of companies that compete with Webflow in other areas
of business).
"Prohibited Uses" means any implementation and/or use of GSAP Products in tools
that allow users to build visual animations without code that encourages, induces,
or materially assists in creating a solution that competes with Webflow’s visual
animation building capabilities.
"Competitive Products" means any software, tool, or service that enables users to
create, edit, or manage animations through a visual interface or builder similar
to Webflow.

### II. Grant of license

Subject to the terms and conditions of this GSAP License, Webflow grants you a
non-exclusive, worldwide license to use, reproduce, display, and implement GSAP
Products solely for Permitted Uses.

### III. Restrictions

You may not:
1. Use any GSAP Products for any Prohibited Uses without prior written consent;
2. Reverse engineer any GSAP Products for the purpose of creating Competitive Products;
3. Remove or alter any proprietary notices or branding from GSAP Products.

### IV. Ownership and intellectual property

All intellectual property rights in GSAP Products, including but not limited to
copyright, patents, trademarks, and trade secrets, remain the exclusive property
of Webflow. This GSAP License does not transfer any ownership rights in GSAP
Products to you.

### V. Termination

Webflow may terminate this GSAP License and revoke your access in its discretion
if you fail to comply with any of these terms and conditions. Upon termination,
you must cease all use of GSAP Products and destroy all copies in your possession.

### VI. Miscellaneous provisions

1. General: This GSAP License is incorporated into and subject to Webflow’s Terms
   of Service available at https://webflow.com/legal/terms ("Terms of Service").
   In the event of any conflict or inconsistency between this GSAP License and
   the Terms of Service, the terms of this GSAP License shall govern in relation
   to your use of any GSAP Products.
2. Amendments: Webflow reserves the right to update or modify this GSAP License at
   any time by posting the revised terms on this website, provided that any such
   updates or modifications shall not result in any material degradation to the
   security, integrity, or functionality of any GSAP Products. You understand and
   agree that your continued use of any GSAP Products after such revisions to this
   GSAP License constitutes your acceptance of this GSAP License as revised. If
   you do not accept the revised GSAP License, you are prohibited from using
   versions of the GSAP Products released after the effective date of the revised
   GSAP License (as well as any updates made to previous versions). Notwithstanding,
   you may continue using previous versions of GSAP Products under the applicable
   terms licensed to you prior to the effective date of the revised GSAP License
   (for clarity, excluding any updates made thereto).
3. No Waiver: Failure of Webflow to enforce any provision of this GSAP License shall
   not constitute a waiver of future enforcement of that or any other provision.

PHOENIX uses GSAP for fixed game presentation, not a competing visual animation
builder. GSAP permits commercial use under this standard licence; do not relabel
it open-source/MIT. Consult the linked official licence for authoritative terms.
